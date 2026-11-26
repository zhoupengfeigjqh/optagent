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

function sawHeader(name: string): boolean {
  return received.some((headers) => headers[name] !== undefined);
}

beforeEach(async () => {
  received = [];
  server = http.createServer((req, res) => {
    received.push(req.headers);
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        detail: '缺少或无效的访问令牌（请在 MCP 配置中带上该发布服务的令牌请求头）',
      }),
    );
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
