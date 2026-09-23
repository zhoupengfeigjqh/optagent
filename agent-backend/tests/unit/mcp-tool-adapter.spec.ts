/**
 * 单元测试：MCP 工具的 **uid/sid 强制穿透**（2026-09-16）
 *
 * 要求：调用工具时 `uid`（用户 id）与 `sid`（当前会话 id）必须由**运行环境**穿透传入，
 * **MUST NOT 让 LLM 去填**（模型不知道真实值，填错还可能越权访问他人数据）。
 * 同时**不能让不需要这对参数的工具受影响**（第三方服务常常严格校验入参）。
 *
 * 因此判据是"工具自己声明了才注入"：
 * 1. 声明了 → 值一定来自运行环境（覆盖 LLM 填的任何内容），且对 LLM **隐藏**该参数；
 * 2. 没声明 → 参数与 schema **原样透传**，一个多余字段都不加。
 *
 * 另一半：**file_args 取值路径与签名直链铸造**（同为 2026-09-16）——
 * 真实对接方的入参是对象数组（`items: [{ businessType, excelFileUrl }]`），
 * 旧实现只认顶层字符串参数，这类声明"配了也静默不生效"。
 * 本文件守住三条：数组元素能逐项铸造、值已是 http(s) 直链则原样透传（不进沙箱）、
 * 形状不符**报错且不发出调用**（不许静默）。
 */
import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import { PermissionError, type FileAccess } from '../../src/domain/file-access.js';
import type { McpManager } from '../../src/infra/mcp/mcp-manager.js';
import {
  mcpToolsAsAgentTools,
  type FileArgContext,
  type RuntimeContext,
} from '../../src/infra/mcp/mcp-tool-adapter.js';
import type { FileArgMode } from '../../src/domain/file-arg-path.js';
import type { McpCallEvent } from '../../src/types.js';

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
      return '工具结果';
    },
  } as unknown as McpManager;
}

const RUNTIME: RuntimeContext = { uid: 'admin', sid: 'th_123' };

/** 声明了 uid/sid 的工具（模拟外部服务：要求它俩才能定位用户自己的数据） */
const TOOL_WITH_CONTEXT = {
  name: 'query_my_data',
  description: '查询当前用户的数据',
  inputSchema: {
    type: 'object',
    properties: {
      uid: { type: 'string' },
      sid: { type: 'string' },
      keyword: { type: 'string' },
    },
    required: ['uid', 'sid', 'keyword'],
  },
};

/** 没声明 uid/sid 的工具（形状同真实 OCR：只认 image） */
const TOOL_WITHOUT_CONTEXT = {
  name: 'ocr_image',
  description: '识别图片文字',
  inputSchema: {
    type: 'object',
    properties: { image: { type: 'string' } },
    required: ['image'],
  },
};

function buildTools(
  calls: Call[],
  tools: unknown[],
  options: { runtime?: RuntimeContext; fileArgs?: FileArgContext } = {},
) {
  return mcpToolsAsAgentTools(
    fakeManager(calls),
    'svc',
    tools as never,
    options.runtime,
    undefined,
    options.fileArgs,
  );
}

/** 取工具执行结果（适配 pi-agent-core 的 execute 签名） */
async function exec(tool: { execute: (...args: never[]) => Promise<unknown> }, params: unknown) {
  return (await tool.execute('call_1' as never, params as never)) as {
    content: Array<{ text: string }>;
  };
}

describe('MCP 调用事件埋点：服务 / 工具 / 耗时 / 错误分类（2026-09-23）', () => {
  /** 与真实 OCR 同形：只认 image，未声明 uid/sid */
  const EVENT_TOOL = {
    name: 'ocr_image',
    description: '识别图片文字',
    inputSchema: {
      type: 'object',
      properties: { image: { type: 'string' } },
      required: ['image'],
    },
  };

  /** 只关心计数事件：callTool 的成功/失败由用例决定 */
  function build(events: McpCallEvent[], callTool: () => Promise<unknown>) {
    const [tool] = mcpToolsAsAgentTools(
      { callTool } as unknown as McpManager,
      'svc',
      [EVENT_TOOL] as never,
      RUNTIME,
      undefined,
      undefined,
      (event) => events.push(event),
    );
    return tool!;
  }

  it('成功：带服务名、MCP 工具名（不带 {server}__ 前缀）、耗时、用户与会话', async () => {
    const events: McpCallEvent[] = [];
    await exec(build(events, async () => 'ok'), { image: 'a.png' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      service: 'svc',
      // 落库的是 MCP 服务自己的工具名，而非暴露给模型的 `svc__ocr_image`
      tool: 'ocr_image',
      ok: true,
      userId: 'admin',
      threadId: 'th_123',
    });
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(0);
    // 成功不留错误分类（避免"ok=1 却有 errorKind"的歧义行）
    expect(events[0]!.errorKind).toBeUndefined();
  });

  it('失败：带 ok=false 与错误分类，且原错误仍上抛（埋点不吞异常）', async () => {
    const events: McpCallEvent[] = [];
    const tool = build(events, async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    });

    await expect(exec(tool, { image: 'a.png' })).rejects.toThrow('ECONNREFUSED');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      service: 'svc',
      tool: 'ocr_image',
      ok: false,
      errorKind: 'transport',
      userId: 'admin',
      threadId: 'th_123',
    });
  });

  it('无运行上下文：事件照记，用户/会话为 null（不静默丢事件）', async () => {
    const events: McpCallEvent[] = [];
    const [tool] = mcpToolsAsAgentTools(
      { callTool: async () => 'ok' } as unknown as McpManager,
      'svc',
      [EVENT_TOOL] as never,
      undefined,
      undefined,
      undefined,
      (event) => events.push(event),
    );

    await exec(tool!, { image: 'a.png' });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ ok: true, userId: null, threadId: null });
  });

  it('file_args 校验失败（调用未发出）：不记事件，守住"计数 = 工具调用次数"口径', async () => {
    const events: McpCallEvent[] = [];
    const calls: Call[] = [];
    const [tool] = mcpToolsAsAgentTools(
      fakeManager(calls),
      'svc',
      [EVENT_TOOL] as never,
      RUNTIME,
      { ocr_image: { image: 'url' } },
      sandbox(),
      (event) => events.push(event),
    );

    const result = await exec(tool!, { image: '不存在/a.png' });

    expect(result.content[0]?.text).toContain('文件参数校验失败');
    expect(calls).toHaveLength(0);
    expect(events).toEqual([]);
  });
});

describe('MCP 工具：uid/sid 强制穿透', () => {
  it('声明了 uid/sid：注入的是运行环境的值，LLM 伪造的值被覆盖', async () => {
    const calls: Call[] = [];
    const [tool] = buildTools(calls, [TOOL_WITH_CONTEXT], { runtime: RUNTIME });

    await exec(tool!, { uid: 'someone-else', sid: 'forged-thread', keyword: 'k' });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual({ uid: 'admin', sid: 'th_123', keyword: 'k' });
  });

  it('声明了 uid/sid：LLM 完全不填也能调用成功（值由运行环境补齐）', async () => {
    const calls: Call[] = [];
    const [tool] = buildTools(calls, [TOOL_WITH_CONTEXT], { runtime: RUNTIME });

    await exec(tool!, { keyword: 'k' });

    expect(calls[0]?.args).toEqual({ uid: 'admin', sid: 'th_123', keyword: 'k' });
  });

  it('对 LLM 隐藏穿透参数：properties 与 required 里都不再出现 uid/sid', () => {
    const [tool] = buildTools([], [TOOL_WITH_CONTEXT], { runtime: RUNTIME });
    const schema = tool!.parameters as {
      properties: Record<string, unknown>;
      required?: string[];
    };

    expect(Object.keys(schema.properties)).toEqual(['keyword']);
    expect(schema.required).toEqual(['keyword']);
  });

  it('未声明的工具完全不受影响：参数与 schema 原样透传（不加多余字段）', async () => {
    const calls: Call[] = [];
    const [tool] = buildTools(calls, [TOOL_WITHOUT_CONTEXT], { runtime: RUNTIME });

    expect(tool!.parameters).toBe(TOOL_WITHOUT_CONTEXT.inputSchema); // 对象未被改写
    await exec(tool!, { image: '临时空间/a.png' });

    expect(calls[0]?.args).toEqual({ image: '临时空间/a.png' });
  });

  it('与 file_args 共存：先换签名直链，再注入 uid/sid', async () => {
    const calls: Call[] = [];
    const fileCtx = {
      fileAccess: {
        resolveVerified: (value: string) => ({ relPath: `users/admin/user-data/${value}` }),
      } as unknown as FileAccess,
      userId: 'admin',
      mintUrl: (_userId: string, relPath: string) => `https://signed.example/${relPath}`,
    } satisfies FileArgContext;

    const tool = {
      name: 'upload',
      inputSchema: {
        type: 'object',
        properties: { uid: { type: 'string' }, sid: { type: 'string' }, path: { type: 'string' } },
        required: ['uid', 'sid', 'path'],
      },
    };
    const [built] = mcpToolsAsAgentTools(
      fakeManager(calls),
      'svc',
      [tool] as never,
      RUNTIME,
      { upload: { path: 'url' } },
      fileCtx,
    );

    await exec(built!, { path: '临时空间/a.png' });

    expect(calls[0]?.args).toEqual({
      path: 'https://signed.example/users/admin/user-data/临时空间/a.png',
      uid: 'admin',
      sid: 'th_123',
    });
  });

  it('缺少运行上下文时不注入、不抛错（防御：不该悄悄塞 undefined）', async () => {
    const calls: Call[] = [];
    const [tool] = buildTools(calls, [TOOL_WITH_CONTEXT]);

    await exec(tool!, { keyword: 'k' });

    expect(calls[0]?.args).toEqual({ keyword: 'k' });
    // 对 LLM 的隐藏与"有没有拿到上下文"无关：这些参数永远不该由模型填
    const schema = tool!.parameters as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).toEqual(['keyword']);
  });

  it('工具没有 properties 的 schema 也不会崩（不注入、原样透传）', async () => {
    const calls: Call[] = [];
    const [tool] = buildTools(calls, [{ name: 'x', inputSchema: { type: 'object' } }], {
      runtime: RUNTIME,
    });

    await exec(tool!, { a: 1 });
    expect(calls[0]?.args).toEqual({ a: 1 });
  });
});

/* ------------------------------------------------------------------------------------ *
 * file_args 取值路径：对象数组里的字段也要能铸造（2026-09-16）
 * ------------------------------------------------------------------------------------ */

/** 真实对接方的 schema（对方提供）：要铸造的是数组元素里的 `excelFileUrl` */
const PARSE_EXCEL_FILES = {
  name: 'parse_excel_files',
  description: '读取并解析排产业务 Excel 文件',
  inputSchema: {
    type: 'object',
    properties: {
      userId: { type: 'integer' },
      conversationId: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            businessType: { type: 'integer' },
            excelFileUrl: { type: 'string' },
          },
        },
      },
    },
    required: ['userId', 'conversationId', 'items'],
  },
};

/** 声明：数组 `items` 每个元素的 `excelFileUrl` 都要铸 */
const ITEMS_DECL = { parse_excel_files: { 'items[].excelFileUrl': 'url' } };

/**
 * 假的沙箱：记录"进过沙箱的值"，用来断言**外部直链没有被当成本地路径处理**
 * （真送进去会被判"目录不在白名单"，把整次调用误伤）。
 */
function sandbox(verified: string[] = []): FileArgContext {
  return {
    fileAccess: {
      resolveVerified: (value: string) => {
        verified.push(value);
        if (value.includes('不存在')) throw new PermissionError(`文件不存在或不可读: ${value}`);
        return { relPath: `users/admin/user-data/${value}` };
      },
    } as unknown as FileAccess,
    userId: 'admin',
    mintUrl: (_userId: string, relPath: string) => `https://signed.example/${relPath}`,
  };
}

/** 收集日志：`file_args` 取不到值必须留下痕迹（这是"配了不生效"唯一可查的线索） */
function captureLogger(): {
  logger: Logger;
  warns: Array<Record<string, unknown>>;
  infos: Array<Record<string, unknown>>;
} {
  const warns: Array<Record<string, unknown>> = [];
  const infos: Array<Record<string, unknown>> = [];
  const logger = {
    warn: (fields: Record<string, unknown>) => {
      warns.push(fields);
    },
    info: (fields: Record<string, unknown>) => {
      infos.push(fields);
    },
  } as unknown as Logger;
  return { logger, warns, infos };
}

interface FileArgsBuildOptions {
  decls?: Record<string, Record<string, FileArgMode>>;
  ctx?: FileArgContext;
  logger?: Logger;
}

function buildWithFileArgs(calls: Call[], tools: unknown[], options: FileArgsBuildOptions = {}) {
  return mcpToolsAsAgentTools(
    fakeManager(calls),
    'svc',
    tools as never,
    undefined,
    options.decls,
    options.ctx,
    undefined,
    options.logger,
  );
}

/** 取最终发给服务的入参（断言用；形状由各用例自己声明） */
function sentArgs<T>(calls: Call[]): T {
  expect(calls).toHaveLength(1);
  return calls[0]!.args as T;
}

describe('MCP 文件参数：取值路径与签名直链铸造', () => {
  it('对象数组的元素字段逐个铸造（真实 schema：items[].excelFileUrl）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [
        { businessType: 1, excelFileUrl: '临时空间/产能.xlsx' },
        { businessType: 4, excelFileUrl: '数据准备/排产/计划.xlsx' },
      ],
    });

    expect(sentArgs(calls)).toEqual({
      userId: 1,
      conversationId: 'c1',
      items: [
        {
          businessType: 1,
          excelFileUrl: 'https://signed.example/users/admin/user-data/临时空间/产能.xlsx',
        },
        {
          businessType: 4,
          excelFileUrl: 'https://signed.example/users/admin/user-data/数据准备/排产/计划.xlsx',
        },
      ],
    });
  });

  it('值已是 http(s) 直链：原样透传、不进沙箱，且不影响同批里的相对路径', async () => {
    const calls: Call[] = [];
    const verified: string[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(verified),
    });

    await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [
        { businessType: 2, excelFileUrl: 'https://files.example.com/产线.xlsx' },
        { businessType: 3, excelFileUrl: '临时空间/电价.xlsx' },
      ],
    });

    const { items } = sentArgs<{ items: Array<{ excelFileUrl: string }> }>(calls);
    expect(items[0]?.excelFileUrl).toBe('https://files.example.com/产线.xlsx'); // 外部直链不动
    expect(items[1]?.excelFileUrl).toBe(
      'https://signed.example/users/admin/user-data/临时空间/电价.xlsx',
    );
    expect(verified).toEqual(['临时空间/电价.xlsx']); // 外部直链从未被当成本地路径
  });

  it('字符串数组逐元素铸造：files[]', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(
      calls,
      [
        {
          name: 'upload_many',
          inputSchema: { type: 'object', properties: { files: { type: 'array' } } },
        },
      ],
      { decls: { upload_many: { 'files[]': 'url' } }, ctx: sandbox() },
    );

    await exec(tool!, { files: ['临时空间/a.png', '共享空间/b.png'] });

    expect(sentArgs(calls)).toEqual({
      files: [
        'https://signed.example/users/admin/user-data/临时空间/a.png',
        'https://signed.example/users/admin/user-data/共享空间/b.png',
      ],
    });
  });

  it('多级嵌套：groups[].files[].url（其余字段原样保留）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(
      calls,
      [{ name: 'batch', inputSchema: { type: 'object', properties: { groups: { type: 'array' } } } }],
      { decls: { batch: { 'groups[].files[].url': 'url' } }, ctx: sandbox() },
    );

    await exec(tool!, {
      groups: [
        { label: 'A', files: [{ url: '临时空间/a.png', size: 1 }] },
        { label: 'B', files: [{ url: '共享空间/b.png', size: 2 }] },
      ],
    });

    expect(sentArgs(calls)).toEqual({
      groups: [
        {
          label: 'A',
          files: [{ url: 'https://signed.example/users/admin/user-data/临时空间/a.png', size: 1 }],
        },
        {
          label: 'B',
          files: [{ url: 'https://signed.example/users/admin/user-data/共享空间/b.png', size: 2 }],
        },
      ],
    });
  });

  it('顶层参数名仍是老行为（回归：引入路径写法没把既有配置改坏）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [TOOL_WITHOUT_CONTEXT], {
      decls: { ocr_image: { image: 'url' } },
      ctx: sandbox(),
    });

    await exec(tool!, { image: '临时空间/a.png' });

    expect(sentArgs(calls)).toEqual({
      image: 'https://signed.example/users/admin/user-data/临时空间/a.png',
    });
  });

  it('路径上的键本次没提供：原样透传 + 告警日志（不抛错、也不静默）', async () => {
    const calls: Call[] = [];
    const { logger, warns } = captureLogger();
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
      logger,
    });

    await exec(tool!, { userId: 1, conversationId: 'c1' });

    expect(sentArgs(calls)).toEqual({ userId: 1, conversationId: 'c1' }); // 一个字段都没加
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({
      event: 'mcp.fileargs.unmatched',
      service: 'svc',
      tool: 'parse_excel_files',
      path: 'items[].excelFileUrl',
    });
  });

  it('数组元素缺该字段：只那项原样保留，其余照铸（该必填项交给服务端校验）', async () => {
    const calls: Call[] = [];
    const { logger, warns } = captureLogger();
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
      logger,
    });

    await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [{ businessType: 1, excelFileUrl: '临时空间/a.xlsx' }, { businessType: 2 }],
    });

    const { items } = sentArgs<{ items: Array<Record<string, unknown>> }>(calls);
    expect(items[0]?.excelFileUrl).toBe(
      'https://signed.example/users/admin/user-data/临时空间/a.xlsx',
    );
    expect(items[1]).toEqual({ businessType: 2 });
    expect(warns).toHaveLength(1);
  });

  it('空数组：不报错（"这批没有文件"是合法入参）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    await exec(tool!, { userId: 1, conversationId: 'c1', items: [] });

    expect(sentArgs(calls)).toEqual({ userId: 1, conversationId: 'c1', items: [] });
  });

  it('形状不符（items 不是数组）→ 报错且**调用不发出**（此前是静默跳过）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, { userId: 1, conversationId: 'c1', items: '临时空间/a.xlsx' });

    expect(calls).toHaveLength(0);
    expect(result.content[0]?.text).toContain('文件参数校验失败');
    expect(result.content[0]?.text).toContain('items 应为数组');
    expect(result.content[0]?.text).toContain('实际是 string');
  });

  it('形状不符（元素不是对象）→ 报错里带元素下标，长清单里能直接定位', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [{ businessType: 1, excelFileUrl: '临时空间/a.xlsx' }, '临时空间/b.xlsx'],
    });

    expect(calls).toHaveLength(0);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('应为对象');
    expect(text).toContain('（元素 items[1]）');
  });

  it('形状不符（叶子不是字符串）→ 报错（数字/对象一律不放行）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [{ businessType: 1, excelFileUrl: 123 }],
    });

    expect(calls).toHaveLength(0);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('items[].excelFileUrl 应为字符串');
    expect(text).toContain('实际是 number');
  });

  it('声明路径非法（兜底）：报错，而不是"当顶层参数名静默取不到值"', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: { parse_excel_files: { 'items[0]': 'url' } },
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [{ businessType: 1, excelFileUrl: '临时空间/a.xlsx' }],
    });

    expect(calls).toHaveLength(0);
    expect(result.content[0]?.text).toContain('不是合法取值路径');
  });

  it('沙箱拒绝（文件不存在）→ 仍是可读的工具结果，且带元素下标', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      userId: 1,
      conversationId: 'c1',
      items: [{ businessType: 1, excelFileUrl: '临时空间/不存在.xlsx' }],
    });

    expect(calls).toHaveLength(0);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('文件不存在或不可读');
    expect(text).toContain('（元素 items[0]）');
  });

  it('入参不是对象时原样透传（不碰第三方给的形状）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [PARSE_EXCEL_FILES], {
      decls: ITEMS_DECL,
      ctx: sandbox(),
    });

    await exec(tool!, 'not-an-object');

    expect(calls[0]?.args).toBe('not-an-object');
  });
});

/* ------------------------------------------------------------------------------------ *
 * 派生模式 "url:from="（2026-09-18）：目标字段由引擎注入、覆盖模型填写、对 LLM 隐藏
 * 起因：hd_algorithm_input_parser 的 excelFileUrl 描述要求 http 地址，
 * 模型据此幻觉伪造 URL；该字段本是"纯管道字段"，不该由模型决策。
 * ------------------------------------------------------------------------------------ */

/** 真实 schema（hd_algorithm_input_parser）：对象数组，来源字段与目标字段同层 */
const HD_PARSER = {
  name: 'hd_algorithm_input_parser',
  description: '排产算法输入解析',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            businessType: { type: 'integer' },
            excelFileUrl: { type: 'string', description: '可下载的 http/https 地址' },
            realRelativePath: { type: 'string', description: '服务器真实相对路径' },
          },
          required: ['businessType', 'excelFileUrl', 'realRelativePath'],
        },
      },
    },
    required: ['items'],
  },
};

const DERIVED_DECL = {
  hd_algorithm_input_parser: {
    'items[].excelFileUrl': 'url:from=items[].realRelativePath',
  } as Record<string, FileArgMode>,
};

describe('MCP 文件参数：派生模式 "url:from="（目标字段引擎注入）', () => {
  it('模型只填来源字段：目标字段逐元素铸造注入，来源原样保留', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
    });

    await exec(tool!, {
      items: [
        { businessType: 1, realRelativePath: '临时空间/产能.xlsx' },
        { businessType: 4, realRelativePath: '数据准备/排产/计划.xlsx' },
      ],
    });

    expect(sentArgs(calls)).toEqual({
      items: [
        {
          businessType: 1,
          realRelativePath: '临时空间/产能.xlsx',
          excelFileUrl: 'https://signed.example/users/admin/user-data/临时空间/产能.xlsx',
        },
        {
          businessType: 4,
          realRelativePath: '数据准备/排产/计划.xlsx',
          excelFileUrl: 'https://signed.example/users/admin/user-data/数据准备/排产/计划.xlsx',
        },
      ],
    });
  });

  it('模型幻觉的伪造 http 地址被无条件覆盖（根治点）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
    });

    await exec(tool!, {
      items: [
        {
          businessType: 1,
          realRelativePath: '临时空间/产能.xlsx',
          excelFileUrl: 'http://hallucinated.example/fake.xlsx', // 模型编造的地址
        },
      ],
    });

    const { items } = sentArgs<{ items: Array<{ excelFileUrl: string }> }>(calls);
    expect(items[0]?.excelFileUrl).toBe(
      'https://signed.example/users/admin/user-data/临时空间/产能.xlsx',
    );
  });

  it('派生注入打 mcp.fileargs.derived 日志（注入可观测）', async () => {
    const calls: Call[] = [];
    const { logger, infos } = captureLogger();
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
      logger,
    });

    await exec(tool!, { items: [{ businessType: 1, realRelativePath: '临时空间/产能.xlsx' }] });

    const derived = infos.filter((e) => e['event'] === 'mcp.fileargs.derived');
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      event: 'mcp.fileargs.derived',
      service: 'svc',
      tool: 'hd_algorithm_input_parser',
      path: 'items[].excelFileUrl',
      from: 'items[].realRelativePath',
    });
  });

  it('目标字段对 LLM 隐藏：嵌套 properties 与 required 里都剔除 excelFileUrl', () => {
    const [tool] = buildWithFileArgs([], [HD_PARSER], { decls: DERIVED_DECL, ctx: sandbox() });
    const schema = tool!.parameters as {
      properties: { items: { items: { properties: Record<string, unknown>; required: string[] } } };
      required: string[];
    };

    const itemSchema = schema.properties.items.items;
    expect(Object.keys(itemSchema.properties)).toEqual(['businessType', 'realRelativePath']);
    expect(itemSchema.required).toEqual(['businessType', 'realRelativePath']);
    expect(schema.required).toEqual(['items']);
  });

  it('顶层平铺派生同样生效：excelFileUrl ← realRelativePath，顶层 schema 隐藏', async () => {
    const calls: Call[] = [];
    const flatTool = {
      name: 'flat_parser',
      inputSchema: {
        type: 'object',
        properties: {
          businessType: { type: 'integer' },
          excelFileUrl: { type: 'string' },
          realRelativePath: { type: 'string' },
        },
        required: ['businessType', 'excelFileUrl', 'realRelativePath'],
      },
    };
    const [tool] = buildWithFileArgs(calls, [flatTool], {
      decls: { flat_parser: { excelFileUrl: 'url:from=realRelativePath' } },
      ctx: sandbox(),
    });

    await exec(tool!, { businessType: 2, realRelativePath: '临时空间/电价.xlsx' });

    expect(sentArgs(calls)).toEqual({
      businessType: 2,
      realRelativePath: '临时空间/电价.xlsx',
      excelFileUrl: 'https://signed.example/users/admin/user-data/临时空间/电价.xlsx',
    });
    const schema = tool!.parameters as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['businessType', 'realRelativePath']);
    expect(schema.required).toEqual(['businessType', 'realRelativePath']);
  });

  it('来源字段缺失 → 报错且调用不发出（让模型自我纠正，不静默透传）', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, { items: [{ businessType: 1 }] });

    expect(calls).toHaveLength(0);
    expect(result.content[0]?.text).toContain('缺少派生来源字段「realRelativePath」');
  });

  it('来源字段为空串 → 报错且调用不发出', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      items: [{ businessType: 1, realRelativePath: '  ' }],
    });

    expect(calls).toHaveLength(0);
    expect(result.content[0]?.text).toContain('为空串');
  });

  it('来源文件沙箱拒绝（不存在）→ 可读的工具结果，错误带元素下标', async () => {
    const calls: Call[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(),
    });

    const result = await exec(tool!, {
      items: [
        { businessType: 1, realRelativePath: '临时空间/产能.xlsx' },
        { businessType: 2, realRelativePath: '临时空间/不存在.xlsx' },
      ],
    });

    expect(calls).toHaveLength(0);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('文件不存在或不可读');
    expect(text).toContain('（元素 items[1]）');
  });

  it('来源已是 http(s) 直链：目标字段透传该直链（不进沙箱，与普通模式同一判据）', async () => {
    const calls: Call[] = [];
    const verified: string[] = [];
    const [tool] = buildWithFileArgs(calls, [HD_PARSER], {
      decls: DERIVED_DECL,
      ctx: sandbox(verified),
    });

    await exec(tool!, {
      items: [{ businessType: 1, realRelativePath: 'https://files.example.com/产线.xlsx' }],
    });

    const { items } = sentArgs<{ items: Array<{ excelFileUrl: string }> }>(calls);
    expect(items[0]?.excelFileUrl).toBe('https://files.example.com/产线.xlsx');
    expect(verified).toEqual([]); // 外部直链从未进沙箱
  });

  it('与普通 url 声明共存：先原位铸造、再派生注入，互不干扰', async () => {
    const calls: Call[] = [];
    const mixedTool = {
      name: 'mixed',
      inputSchema: {
        type: 'object',
        properties: { image: { type: 'string' }, excelFileUrl: { type: 'string' }, realRelativePath: { type: 'string' } },
      },
    };
    const [tool] = buildWithFileArgs(calls, [mixedTool], {
      decls: {
        mixed: { image: 'url', excelFileUrl: 'url:from=realRelativePath' },
      },
      ctx: sandbox(),
    });

    await exec(tool!, {
      image: '临时空间/a.png',
      realRelativePath: '临时空间/产能.xlsx',
      excelFileUrl: 'http://hallucinated/fake.xlsx',
    });

    expect(sentArgs(calls)).toEqual({
      image: 'https://signed.example/users/admin/user-data/临时空间/a.png',
      realRelativePath: '临时空间/产能.xlsx',
      excelFileUrl: 'https://signed.example/users/admin/user-data/临时空间/产能.xlsx',
    });
  });
});
