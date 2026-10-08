/**
 * 单元测试：MCP 客户端的**请求头注入**（2026-10-08）
 *
 * 为什么单独测这一层：请求头是**凭据**——平台回显只给掩码、`McpTestReport.target`
 * 也不含它，所以"配了到底发没发"在别处都看不出来。少发一次的症状是**一串 401**，
 * 服务本身是好的，从现象上几乎无法自查。
 *
 * 验证方式刻意**不用 mock**：起一个真实的本地 HTTP 桩服务器，让 SDK 的真传输层去连，
 * 直接断言**服务器收到的请求头**——这等于在线上路径上钉了一颗钉子（含真实 URL /
 * 真实 `requestInit` 传递 / 真实 HTTP 报文）。
 *
 * 桩服务器一律回 401（复刻本体侧自建发布的表现），顺带覆盖"服务不可用时降级不崩"。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpManager } from '../../src/infra/mcp/mcp-manager.js';
import type { McpServerConfig } from '../../src/types.js';

const TOKEN_HEADER = 'x-mcp-token';
const TOKEN = 'tk-1234567890';

let server: http.Server;
let received: http.IncomingHttpHeaders[] = [];
let url: string;

function httpServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name: 'raw', transport: 'http', url, ...overrides };
}

/** 该次连接的请求里是否带上某个头（头名大小写不敏感） */
function sawHeader(name: string): boolean {
  return received.some((headers) => headers[name] !== undefined);
}

beforeEach(async () => {
  received = [];
  server = http.createServer((req, res) => {
    received.push(req.headers);
    // 复刻自建发布容器的表现：没有令牌直接 401（连 MCP 握手都到不了）
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: '缺少或无效的访问令牌（请在 MCP 配置中带上该发布服务的令牌请求头）' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('MCP 传输层的请求头注入', () => {
  it('配了 headers → 请求真的带上该头（原样，不掩码）', async () => {
    const manager = new McpManager({ timeoutMs: 500 });
    await manager.connectAll([httpServer({ headers: { 'X-MCP-Token': TOKEN } })]);

    expect(sawHeader(TOKEN_HEADER)).toBe(true);
    expect(received[0]?.[TOKEN_HEADER]).toBe(TOKEN);
    await manager.closeAll();
  });

  it('没配 headers / 配了空对象 → 请求里 MUST NOT 出现该头（不发送空头）', async () => {
    const manager = new McpManager({ timeoutMs: 500 });
    await manager.connectAll([httpServer(), httpServer({ name: 'b', headers: {} })]);

    expect(received.length).toBeGreaterThan(0);
    expect(sawHeader(TOKEN_HEADER)).toBe(false);
    await manager.closeAll();
  });

  it('服务返回 401 时降级为不可用（不抛出、不崩），且进重连名单', async () => {
    const manager = new McpManager({ timeoutMs: 500 });
    const result = await manager.connectAll([httpServer({ headers: { 'X-MCP-Token': TOKEN } })]);

    expect(result.unavailable).toEqual(['raw']);
    expect(manager.isAvailable('raw')).toBe(false);
    await manager.closeAll();
  });

  it('再次 connectAll（重连路径）仍带请求头：配置被整体留存，不因重连丢令牌', async () => {
    const manager = new McpManager({ timeoutMs: 500 });
    const cfg = httpServer({ headers: { 'X-MCP-Token': TOKEN } });
    await manager.connectAll([cfg]);
    await manager.connectAll([cfg]);

    const withToken = received.filter((headers) => headers[TOKEN_HEADER] === TOKEN);
    expect(withToken.length).toBeGreaterThanOrEqual(2);
    await manager.closeAll();
  });
});
