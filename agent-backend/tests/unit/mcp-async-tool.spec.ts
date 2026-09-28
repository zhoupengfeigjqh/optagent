/**
 * 单元测试：MCP 异步工具的 `result_url` 注入（R11，契约 §10.6 不变式 1/2/6）
 *
 * 三条不变式：
 * 1. **未声明即零变化** —— `async_tools` 缺省/空数组时，不注入、schema 原样；
 * 2. **注入对 LLM 隐藏且覆盖模型填写** —— 模型不可能幻觉出一个假的回写地址；
 * 6. **配了但服务收不到地址要告警** —— 不静默失效。
 *
 * 独立成文件：`mcp-tool-adapter.spec.ts` 已远超 500 行门禁（既有状态），
 * 新用例不再往里堆（宪章原则二）。
 */
import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { McpManager } from '../../src/infra/mcp/mcp-manager.js';
import {
  mcpToolsAsAgentTools,
  type RuntimeContext,
} from '../../src/infra/mcp/mcp-tool-adapter.js';
import { declaresResultUrl, injectResultUrl } from '../../src/infra/mcp/async-result-url.js';

interface Call {
  server: string;
  tool: string;
  args: unknown;
}

/** 只实现 callTool 的假 manager（本用例只关心"最终发出去的参数"） */
function fakeManager(calls: Call[]) {
  return {
    callTool: async (server: string, tool: string, args: unknown) => {
      calls.push({ server, tool, args });
      return '已受理';
    },
  } as unknown as McpManager;
}

const RUNTIME: RuntimeContext = { uid: 'admin', sid: 'th_123' };

/** 声明了 result_url 的工具（服务侧已按异步口径改造） */
const ASYNC_TOOL = {
  name: 'submit_job',
  description: '提交后台计算任务',
  inputSchema: {
    type: 'object',
    properties: { result_url: { type: 'string' }, plan: { type: 'string' } },
    required: ['result_url', 'plan'],
  },
};

/** 被声明为异步，但 schema 里没有 result_url（服务侧尚未改造） */
const ASYNC_TOOL_NO_PARAM = {
  name: 'submit_legacy',
  description: '提交任务（未声明回写地址）',
  inputSchema: { type: 'object', properties: { plan: { type: 'string' } } },
};

interface AsyncCtxLike {
  tools: string[];
  mintResultUrl: (tool: string, callId: string) => string;
}

function build(calls: Call[], tools: unknown[], asyncCtx?: AsyncCtxLike, warns: string[] = []) {
  return mcpToolsAsAgentTools(
    fakeManager(calls),
    'svc',
    tools as never,
    RUNTIME,
    undefined,
    undefined,
    undefined,
    // pino 的 warn 是 (obj, msg) 两参形态；测试只关心可读文案。
    // `info` 也必须存在：调用成功路径会记 `mcp.tool.call`
    {
      warn: (_obj: unknown, msg?: string) => warns.push(msg ?? String(_obj)),
      info: () => {},
    } as unknown as Logger,
    asyncCtx,
  );
}

const ctx = (tools: string[]): AsyncCtxLike => ({
  tools,
  mintResultUrl: (tool, callId) =>
    `https://backend/api/files/put?tool=${tool}&call_id=${callId}&sig=x`,
});

/** 取工具执行结果（适配 pi-agent-core 的 execute 签名） */
async function exec(tool: { execute: (...args: never[]) => Promise<unknown> }, params: unknown) {
  return (await tool.execute('call_1' as never, params as never)) as {
    content: Array<{ text: string }>;
  };
}

describe('R11 异步工具：result_url 注入', () => {
  it('未声明 async_tools（不传 asyncCtx）：不注入、schema 原样（不变式 1）', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [ASYNC_TOOL]);

    expect(
      (tool!.parameters as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty('result_url');
    await exec(tool!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({ plan: 'p1' });
  });

  it('命中声明：注入运行环境的地址并覆盖模型填的假地址，且该参数对 LLM 隐藏', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [ASYNC_TOOL], ctx(['submit_job']));

    // 隐藏：暴露给 LLM 的 schema 里没有 result_url（required 里的同名项一并移除）
    const exposed = tool!.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(exposed.properties).not.toHaveProperty('result_url');
    expect(exposed.required).toEqual(['plan']);

    // 注入且覆盖：模型塞的伪造地址一律作废
    await exec(tool!, { plan: 'p1', result_url: 'http://evil.example/put' });
    expect(calls[0]!.args).toEqual({
      plan: 'p1',
      result_url: 'https://backend/api/files/put?tool=submit_job&call_id=call_1&sig=x',
    });
  });

  it('未在声明清单里的工具：完全不受影响（同一服务下混排）', async () => {
    const calls: Call[] = [];
    const [tool] = build(calls, [ASYNC_TOOL], ctx(['other_tool']));

    expect(
      (tool!.parameters as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty('result_url');
    await exec(tool!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({ plan: 'p1' });
  });

  it('声明为异步但 schema 未声明 result_url：不注入 + 装配期告警（不变式 6）', async () => {
    const calls: Call[] = [];
    const warns: string[] = [];
    const [tool] = build(calls, [ASYNC_TOOL_NO_PARAM], ctx(['submit_legacy']), warns);

    expect(warns.join('\n')).toContain('result_url');
    expect(warns.join('\n')).toContain('submit_legacy');

    await exec(tool!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({ plan: 'p1' }); // 不塞多余字段
  });

  it('与 uid/sid 穿透共存：两类注入互不干扰', async () => {
    const calls: Call[] = [];
    const tool = {
      name: 'submit_async',
      description: '异步任务（同时声明 uid/sid/result_url）',
      inputSchema: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          sid: { type: 'string' },
          result_url: { type: 'string' },
          plan: { type: 'string' },
        },
        required: ['uid', 'sid', 'result_url', 'plan'],
      },
    };
    const [built] = build(calls, [tool], ctx(['submit_async']));

    const exposed = built!.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(exposed.properties).not.toHaveProperty('result_url');
    expect(exposed.properties).not.toHaveProperty('uid');
    expect(exposed.required).toEqual(['plan']);

    await exec(built!, { plan: 'p1' });
    expect(calls[0]!.args).toEqual({
      plan: 'p1',
      uid: 'admin',
      sid: 'th_123',
      result_url: 'https://backend/api/files/put?tool=submit_async&call_id=call_1&sig=x',
    });
  });
});

describe('注入原语（边界）', () => {
  it('声明判定：schema 缺失 / 无 properties / 无该键 / 有该键', () => {
    expect(declaresResultUrl(null)).toBe(false);
    expect(declaresResultUrl(undefined)).toBe(false);
    expect(declaresResultUrl({})).toBe(false);
    expect(declaresResultUrl({ properties: { a: { type: 'string' } } })).toBe(false);
    expect(declaresResultUrl({ properties: { result_url: { type: 'string' } } })).toBe(true);
  });

  it('非对象入参原样返回（防御：形状异常交给服务端校验，不臆造结构）', () => {
    expect(injectResultUrl('not-an-object', 'u')).toBe('not-an-object');
    expect(injectResultUrl(42, 'u')).toBe(42);
    expect(injectResultUrl(null, 'u')).toBe(null);
  });

  it('undefined 视为空入参（只带注入字段）', () => {
    expect(injectResultUrl(undefined, 'u')).toEqual({ result_url: 'u' });
  });

  it('对象入参：浅拷贝后写入，不改动原对象', () => {
    const original = { plan: 'p1' };
    const injected = injectResultUrl(original, 'u') as Record<string, unknown>;

    expect(injected).toEqual({ plan: 'p1', result_url: 'u' });
    expect(original).toEqual({ plan: 'p1' });
  });
});
