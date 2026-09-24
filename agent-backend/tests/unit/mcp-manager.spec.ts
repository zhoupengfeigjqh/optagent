/**
 * 单元测试：MCP 连接级失败即降级（2026-09-16 十五次调整，方案 A）。
 *
 * 要守住的场景（真实部署已踩过）：
 * 1. streamable-http 无常驻连接——服务关停后 onClose 不触发，状态恒为绿；
 * 2. 服务重启后旧 session id 被服务端拒（404 "Session not found"），
 *    而失败路径只记日志不清理 → 旧客户端永久占坑，工具反复被剔除，直到实例换代。
 *
 * 方案 A：callTool/listTools 以连接级错误失败（McpError 以外的一切）即 markUnavailable——
 * 状态变红、排退避重连，重连做全新 initialize 自动恢复，无需重启 backend。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import {
  classifyMcpError,
  isTransportFailure,
  McpManager,
  McpUnavailableError,
  type McpClientLike,
  type McpToolInfo,
} from '../../src/infra/mcp/mcp-manager.js';
import type { McpServerConfig } from '../../src/types.js';

const CFG: McpServerConfig = { name: 'ocr', transport: 'streamable-http', url: 'http://ocr:8000/mcp' };

/** 脚本化假客户端：每段"会话"的行为由调用方注入，可中途切换（模拟服务关停/重启） */
function fakeClient(script: {
  callTool?: (name: string, args: unknown) => Promise<unknown>;
  listTools?: () => Promise<{ tools: McpToolInfo[] }>;
  /** 健康探针；不提供 = 该 server 不支持 ping（探测直接走 listTools） */
  ping?: () => Promise<unknown>;
}): McpClientLike & { close: () => Promise<void> } {
  return {
    listTools: script.listTools ?? (async () => ({ tools: [] })),
    callTool: script.callTool ?? (async () => 'ok'),
    close: async () => {},
    onClose: () => {},
    ...(script.ping ? { ping: script.ping } : {}),
  };
}

/** 连接级失败的典型形态：StreamableHTTPError（如 404 Session not found），非 McpError */
function transportError(message = 'Streamable HTTP error: Session not found'): Error {
  return Object.assign(new Error(message), { code: 404 });
}

describe('McpManager —— 连接级失败即降级（十五次调整）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('callTool 两次尝试均连接级失败 → 服务降级：状态 failed、推送 failed、不再可用', async () => {
    const callTool = vi.fn(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => fakeClient({ callTool }),
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    await manager.connectAll([CFG]);
    expect(manager.statusOf('ocr')).toBe('connected');

    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('connect ECONNREFUSED');

    expect(callTool).toHaveBeenCalledTimes(2); // 首次 + 重试 1 次
    expect(manager.statusOf('ocr')).toBe('failed');
    expect(manager.isAvailable('ocr')).toBe(false);
    expect(statuses).toContainEqual(['ocr', 'failed']);
    await manager.closeAll();
  });

  it('服务重启场景：旧 session 被拒（404）→ 降级 → 退避重连拿到新 session 自动恢复', async () => {
    // 第一段会话：服务"活着"但服务端已遗忘其 session id（容器重启过）
    let session = fakeClient({ callTool: async () => { throw transportError(); } });
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => session,
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    await manager.connectAll([CFG]);

    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('Session not found');
    expect(manager.statusOf('ocr')).toBe('failed');

    // 退避表第一档 5s：重连 = 全新 initialize（这里表现为 createClient 返回新会话）
    session = fakeClient({ callTool: async () => '识别结果' });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(manager.statusOf('ocr')).toBe('connected');
    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(1);
    expect(statuses.filter(([, s]) => s === 'connected')).toHaveLength(2); // 初连 + 重连
    await expect(manager.callTool('ocr', 'ocr_image', {})).resolves.toBe('识别结果');
    await manager.closeAll();
  });

  it('McpError（服务端活着、协议错误）不降级：避免对活服务重连抖动', async () => {
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () =>
        fakeClient({
          callTool: async () => {
            throw new McpError(ErrorCode.InvalidParams, '参数不合法');
          },
        }),
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    await manager.connectAll([CFG]);

    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('参数不合法');

    expect(manager.statusOf('ocr')).toBe('connected');
    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(0);
    await manager.closeAll();
  });

  it('listTools 连接级失败同样降级（工具装配路径，真实 404 日志走的就是这里）', async () => {
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () =>
        fakeClient({
          listTools: async () => {
            throw transportError();
          },
        }),
    });
    await manager.connectAll([CFG]);

    await expect(manager.listTools('ocr')).rejects.toThrow('Session not found');

    expect(manager.statusOf('ocr')).toBe('failed');
    await manager.closeAll();
  });

  it('降级后下次使用即惰性恢复：requireClient 顺势补连，且**那次调用直接成功**', async () => {
    let session = fakeClient({ callTool: async () => { throw new Error('connect ECONNREFUSED'); } });
    const manager = new McpManager({ timeoutMs: 1000, createClient: async () => session });
    await manager.connectAll([CFG]);
    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('ECONNREFUSED');
    expect(manager.statusOf('ocr')).toBe('failed');

    // 服务已复活；不推进重试定时器，直接下一次调用触发惰性补试
    session = fakeClient({ callTool: async () => 'ok' });
    await expect(manager.callTool('ocr', 'ocr_image', {})).resolves.toBe('ok');

    expect(manager.statusOf('ocr')).toBe('connected');
    await manager.closeAll();
  });

  it('幂等：重复失败不叠加状态推送与重连定时器', async () => {
    const statuses: Array<[string, string]> = [];
    // 服务 down：建连本身也失败（连接被拒），此后一直 down
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    // 建连失败同样只推一次 failed（connectAll 路径，既有行为）
    await manager.connectAll([CFG]);
    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(1);

    // 服务仍 down：调用走 requireClient → 惰性补试失败 → McpUnavailableError，
    // 不产生第二次 failed 推送（markUnavailable 对已不在 clients 的服务直接返回）
    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('当前不可用');
    await expect(manager.callTool('ocr', 'ocr_image', {})).rejects.toThrow('当前不可用');

    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(1);
    await manager.closeAll();
  });
});

describe('MCP 调用错误分类（2026-09-23：供统计落库的粗粒度枚举）', () => {
  it('isTransportFailure：连接级错误为真，McpError 为假（与降级判据同源）', () => {
    expect(isTransportFailure(new Error('connect ECONNREFUSED'))).toBe(true);
    expect(isTransportFailure(transportError())).toBe(true);
    expect(isTransportFailure(new McpError(ErrorCode.InvalidParams, '参数不合法'))).toBe(false);
  });

  it('classifyMcpError：从具体到泛化（不可用 > 协议错误 > 传输/其它）', () => {
    expect(classifyMcpError(new McpUnavailableError('ocr'))).toBe('unavailable');
    expect(classifyMcpError(new McpError(ErrorCode.InvalidParams, '参数不合法'))).toBe('protocol');
    expect(classifyMcpError(new Error('connect ECONNREFUSED'))).toBe('transport');
  });

  it('非 Error 值也能归类：不抛错，落到 transport（统计埋点不许反过来搞挂主链路）', () => {
    expect(classifyMcpError('boom')).toBe('transport');
    expect(classifyMcpError(undefined)).toBe('transport');
  });
});

describe('McpManager —— 保活重连（2026-09-23：退避用尽后不再停止）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('退避表走完后转入保活重试：服务恢复后自动接回（无需实例换代/重启）', async () => {
    let reachable = false;
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => {
        if (!reachable) throw new Error('connect ECONNREFUSED');
        return fakeClient({ callTool: async () => 'ok' });
      },
      onStatusChange: (server, status) => statuses.push([server, status]),
    });

    await manager.connectAll([CFG]);
    expect(manager.statusOf('ocr')).toBe('failed');

    // 走完 5 档退避（5s + 15s + 30s + 60s + 60s = 170s）：全部失败，但**不停**
    await vi.advanceTimersByTimeAsync(170_000);
    expect(manager.statusOf('ocr')).toBe('failed');
    expect(manager.isAvailable('ocr')).toBe(false);

    // 服务恢复；再等一个保活周期（120s）→ 自动接回，且工具恢复可用
    reachable = true;
    await vi.advanceTimersByTimeAsync(120_000);

    expect(manager.statusOf('ocr')).toBe('connected');
    expect(manager.isAvailable('ocr')).toBe(true);
    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(1);
    expect(statuses.filter(([, s]) => s === 'connected')).toHaveLength(1);
    await expect(manager.callTool('ocr', 'ocr_image', {})).resolves.toBe('ok');
    await manager.closeAll();
  });

  it('保活期反复失败也不叠加状态推送（避免每 2 分钟骚扰前端）', async () => {
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    await manager.connectAll([CFG]);

    // 覆盖快节奏退避 + 三个保活周期，全程 down
    await vi.advanceTimersByTimeAsync(170_000 + 120_000 * 3);

    expect(manager.statusOf('ocr')).toBe('failed');
    expect(statuses.filter(([, s]) => s === 'failed')).toHaveLength(1);
    await manager.closeAll();
  });
});

describe('McpManager —— 主动健康探测（2026-09-23：补齐假绿）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('探测失败（连接级）→ 降级变红并推送，返回翻转为 failed 的服务', async () => {
    const statuses: Array<[string, string]> = [];
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () =>
        fakeClient({
          ping: async () => {
            throw new Error('connect ECONNREFUSED');
          },
        }),
      onStatusChange: (server, status) => statuses.push([server, status]),
    });
    await manager.connectAll([CFG]);
    expect(manager.statusOf('ocr')).toBe('connected');

    const changed = await manager.probe();

    expect(changed).toEqual(['ocr']);
    expect(manager.statusOf('ocr')).toBe('failed');
    expect(statuses).toContainEqual(['ocr', 'failed']);
    await manager.closeAll();
  });

  it('探测成功：用最轻的 ping，不拉工具清单、不改状态', async () => {
    const ping = vi.fn(async () => ({}));
    const listTools = vi.fn(async () => ({ tools: [] }));
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => fakeClient({ ping, listTools }),
    });
    await manager.connectAll([CFG]);

    expect(await manager.probe()).toEqual([]);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(listTools).not.toHaveBeenCalled();
    expect(manager.statusOf('ocr')).toBe('connected');
    await manager.closeAll();
  });

  it('服务未实现 ping（-32601）→ 回退 listTools 探测，且不误判为故障；下次不再试 ping', async () => {
    const ping = vi.fn(async () => {
      throw new McpError(ErrorCode.MethodNotFound, 'Method not found');
    });
    const listTools = vi.fn(async () => ({ tools: [] }));
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => fakeClient({ ping, listTools }),
    });
    await manager.connectAll([CFG]);

    expect(await manager.probe()).toEqual([]);
    expect(manager.statusOf('ocr')).toBe('connected');

    // 第二次探测：已记下"该 server 无 ping"，直接 listTools，不再白试一次
    await manager.probe();
    expect(ping).toHaveBeenCalledTimes(1);
    expect(listTools).toHaveBeenCalledTimes(2);
    await manager.closeAll();
  });

  it('探测遇到协议错误（McpError）不降级：活服务不该被误判为故障', async () => {
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () =>
        fakeClient({
          ping: async () => {
            throw new McpError(ErrorCode.InvalidParams, '参数不合法');
          },
        }),
    });
    await manager.connectAll([CFG]);

    expect(await manager.probe()).toEqual([]);
    expect(manager.statusOf('ocr')).toBe('connected');
    await manager.closeAll();
  });

  it('不支持 ping 的客户端直接用 listTools 探测', async () => {
    const listTools = vi.fn(async () => ({ tools: [] }));
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => fakeClient({ listTools }),
    });
    await manager.connectAll([CFG]);

    expect(await manager.probe()).toEqual([]);
    expect(listTools).toHaveBeenCalledTimes(1);
    await manager.closeAll();
  });

  it('已降级的服务不参与探测（由保活重连负责），探测不产生额外状态推送', async () => {
    const manager = new McpManager({
      timeoutMs: 1000,
      createClient: async () => {
        throw new Error('connect ECONNREFUSED');
      },
    });
    await manager.connectAll([CFG]);
    expect(manager.statusOf('ocr')).toBe('failed');

    expect(await manager.probe()).toEqual([]);
    expect(manager.statusOf('ocr')).toBe('failed');
    await manager.closeAll();
  });
});
