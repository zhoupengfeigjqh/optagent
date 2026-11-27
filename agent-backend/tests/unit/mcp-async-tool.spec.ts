import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { McpManager } from '../../src/infra/mcp/mcp-manager.js';
import { mcpToolsAsAgentTools, type RuntimeContext } from '../../src/infra/mcp/mcp-tool-adapter.js';
import { declaresResultUrl, injectResultUrl } from '../../src/infra/mcp/async-result-url.js';

interface Call {
  server: string;
  tool: string;
  args: unknown;
}

function fakeManager(calls: Call[]) {
  return {
    callTool: async (server: string, tool: string, args: unknown) => {
      calls.push({ server, tool, args });
      return '已受理';
    },
  } as unknown as McpManager;
}

const RUNTIME: RuntimeContext = { uid: 'admin', sid: 'th_123' };

const ASYNC_TOOL = {
  name: 'submit_job',
  description: '提交后台计算任务',
  inputSchema: {
    type: 'object',
    properties: { resultUrl: { type: 'string' }, plan: { type: 'string' } },
    required: ['resultUrl', 'plan'],
  },
};

const SYNC_TOOL = {
  name: 'submit_legacy',
  description: '提交任务（同步返回）',
  inputSchema: { type: 'object', properties: { plan: { type: 'string' } } },
};

interface AsyncCtxLike {
  mintResultUrl: (tool: string, callId: string) => string;
}

function build(calls: Call[], tools: unknown[], asyncCtx?: AsyncCtxLike) {
  return mcpToolsAsAgentTools(
    fakeManager(calls),
    'svc',
    tools as never,
    RUNTIME,
    undefined,
    undefined,
    undefined,
    // pino 的 info 必须存在：调用成功路径会记 `mcp.tool.call`
    { info: () => {}, warn: () => {} } as unknown as Logger,
    asyncCtx,
  );
}

const ctx = (): AsyncCtxLike => ({
  mintResultUrl: (tool, callId) =>
    `https://backend/api/files/put?tool=${tool}&call_id=${callId}&sig=x`,
});

async function exec(tool: { execute: (...args: never[]) => Promise<unknown> }, params: unknown) {
  return (await tool.execute('call_1' as never, params as never)) as {
    content: Array<{ text: string }>;
  };
}

describe('R11 异步工具：resultUrl 注入（schema 判据）', () => {
  it('schema 声明了 resultUrl → 注入运行环境的地址并覆盖模型填写，且该参数对 LLM 隐藏', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [ASYNC_TOOL], ctx());

    const exposed = tool!.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(exposed.properties).not.toHaveProperty('resultUrl');
    expect(exposed.required).toEqual(['plan']);

    await exec(tool!, { plan: 'p1', resultUrl: 'http://evil.example/put' });
    expect(calls[0]!.args).toEqual({
      plan: 'p1',
      resultUrl: 'https://backend/api/files/put?tool=submit_job&call_id=call_1&sig=x',
    });
  });

  it('schema 未声明 resultUrl → 不注入、schema 原样（同一服务下混排）', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [SYNC_TOOL], ctx());

    const exposed = tool!.parameters as { properties: Record<string, unknown> };
    expect(exposed.properties).toEqual({ plan: { type: 'string' } });

    await exec(tool!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({ plan: 'p1' });
  });

  it('未提供注入依赖（不传 asyncCtx）：不注入、schema 原样（不变式 1）', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [ASYNC_TOOL]);

    expect((tool!.parameters as { properties: Record<string, unknown> }).properties).toHaveProperty(
      'resultUrl',
    );
    await exec(tool!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({ plan: 'p1' });
  });

  it('与 uid/sid 穿透共存：两类注入互不干扰', async () => {
    const calls: Call[] = [];
    const tool = {
      name: 'submit_async',
      description: '异步任务（同时声明 uid/sid/resultUrl）',
      inputSchema: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          sid: { type: 'string' },
          resultUrl: { type: 'string' },
          plan: { type: 'string' },
        },
        required: ['uid', 'sid', 'resultUrl', 'plan'],
      },
    };
    const [built] = build(calls, [tool], ctx());

    const exposed = built!.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(exposed.properties).not.toHaveProperty('resultUrl');
    expect(exposed.properties).not.toHaveProperty('uid');
    expect(exposed.required).toEqual(['plan']);

    await exec(built!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({
      plan: 'p1',
      uid: 'admin',
      sid: 'th_123',
      resultUrl: 'https://backend/api/files/put?tool=submit_async&call_id=call_1&sig=x',
    });
  });
});

describe('注入原语（边界）', () => {
  it('声明判定：schema 缺失 / 无 properties / 无该键 / 有该键', () => {
    expect(declaresResultUrl(null)).toBe(false);
    expect(declaresResultUrl(undefined)).toBe(false);
    expect(declaresResultUrl({})).toBe(false);
    expect(declaresResultUrl({ properties: { a: { type: 'string' } } })).toBe(false);
    expect(declaresResultUrl({ properties: { resultUrl: { type: 'string' } } })).toBe(true);
  });

  it('非对象入参原样返回（防御：形状异常交给服务端校验，不臆造结构）', () => {
    expect(injectResultUrl('not-an-object', 'u')).toBe('not-an-object');
    expect(injectResultUrl(42, 'u')).toBe(42);
    expect(injectResultUrl(null, 'u')).toBe(null);
  });

  it('undefined 视为空入参（只带注入字段）', () => {
    expect(injectResultUrl(undefined, 'u')).toEqual({ resultUrl: 'u' });
  });

  it('对象入参：浅拷贝后写入，不改动原对象', () => {
    const original = { plan: 'p1' };
    const injected = injectResultUrl(original, 'u') as Record<string, unknown>;

    expect(injected).toEqual({ plan: 'p1', resultUrl: 'u' });
    expect(original).toEqual({ plan: 'p1' });
  });
});
