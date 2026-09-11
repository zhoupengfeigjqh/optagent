/**
 * McpManager 单元测试（T021）：mock client factory 注入——
 * 单 server 建连失败不阻断（unavailable 降级）、调用超时+重试 1 次、
 * unavailable server 调用抛 McpUnavailableError。
 */
import { describe, expect, it, vi } from 'vitest';
import { McpManager, McpUnavailableError, type McpClientLike } from '../../src/infra/mcp/mcp-manager';
import type { McpServerConfig } from '../../src/types';

const STDIO: McpServerConfig = { name: 'a', transport: 'stdio', command: 'x' };
const HTTP: McpServerConfig = { name: 'b', transport: 'http', url: 'http://localhost:1/mcp' };

function fakeClient(overrides: Partial<McpClientLike> = {}): McpClientLike {
  return {
    listTools: vi.fn(async () => ({ tools: [{ name: 't1', description: '', inputSchema: { type: 'object' } }] })),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] })),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

describe('McpManager', () => {
  it('单 server 建连失败不阻断：标记 unavailable，其余正常', async () => {
    const ok = fakeClient();
    const m = new McpManager({
      timeoutMs: 1000,
      createClient: async (cfg) => {
        if (cfg.name === 'b') throw new Error('连接被拒');
        return ok;
      },
    });
    const result = await m.connectAll([STDIO, HTTP]);
    expect(result.unavailable).toEqual(['b']);
    expect(await m.listTools('a')).toHaveLength(1);
  });

  it('调用 unavailable server → McpUnavailableError', async () => {
    const m = new McpManager({ timeoutMs: 1000, createClient: async () => fakeClient() });
    await m.connectAll([STDIO]);
    await expect(m.callTool('ghost', 't', {})).rejects.toThrow(McpUnavailableError);
  });

  it('调用超时 → 重试 1 次后仍失败抛错', async () => {
    const callTool = vi.fn(() => new Promise(() => {})); // 永不返回
    const m = new McpManager({
      timeoutMs: 30,
      createClient: async () => fakeClient({ callTool }),
    });
    await m.connectAll([STDIO]);
    await expect(m.callTool('a', 't1', {})).rejects.toThrow(/超时|timeout/i);
    expect(callTool).toHaveBeenCalledTimes(2); // 首次 + 重试 1 次
  });

  it('首次失败重试成功 → 返回结果', async () => {
    let n = 0;
    const callTool = vi.fn(async () => {
      if (n++ === 0) throw new Error('抖动');
      return { content: [{ type: 'text', text: 'ok' }] };
    });
    const m = new McpManager({ timeoutMs: 1000, createClient: async () => fakeClient({ callTool }) });
    await m.connectAll([STDIO]);
    const res = (await m.callTool('a', 't1', {})) as { content: Array<{ text: string }> };
    expect(res.content[0]!.text).toBe('ok');
    expect(callTool).toHaveBeenCalledTimes(2);
  });

  it('closeAll 关闭全部连接且幂等', async () => {
    const c = fakeClient();
    const m = new McpManager({ timeoutMs: 1000, createClient: async () => c });
    await m.connectAll([STDIO]);
    await m.closeAll();
    await m.closeAll();
    expect(c.close).toHaveBeenCalledTimes(1);
    await expect(m.callTool('a', 't1', {})).rejects.toThrow(McpUnavailableError);
  });
});
