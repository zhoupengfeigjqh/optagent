/**
 * 集成测试：MCP 请求头（2026-10-08）
 *
 * 覆盖请求头在**四条真实路径**上的落点与口径：
 * 1. 新建（含门槛探测）——请求头随创建落库，并**随连接带下去**；
 * 2. 详情/列表——只回掩码与 `has_headers`，**任何响应里都不出现明文**；
 * 3. 保存调用配置——缺省沿用（不丢令牌）、提供即替换、`{}` 清空、掩码即 400；
 * 4. 测试与探测——表单值优先，缺省回落到已保存值（界面手上只有掩码）。
 *
 * 单独成文件（与 `mcp.spec.ts` 分居）：本组用例集中在"凭据"这一条线上，
 * 混进主文件会触 500 行门禁（宪章原则二）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

const TOKEN = '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z';
const MASKED = '6UuE…3Z';
const OCR_URL = 'http://192.168.1.2:8000/mcp';
const TOOLS = [{ name: 'ocr_image', description: '识别图片文字', parameters: { type: 'object' } }];

/** 接口新建一个服务（默认带请求头，按需覆盖） */
async function createService(overrides: Record<string, unknown> = {}) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/mcp/services',
    payload: {
      name: 'ocr',
      description: 'OCR 识别服务',
      transport: 'http',
      url: OCR_URL,
      headers: { 'X-MCP-Token': TOKEN },
      allowed_tools: ['ocr_image'],
      ...overrides,
    },
  });
}

async function detail(): Promise<Record<string, unknown>> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
  return res.json() as Record<string, unknown>;
}

/** 当前详情里的 revision（保存用乐观锁） */
async function revision(): Promise<number> {
  return (await detail()).revision as number;
}

/** 保存调用配置（默认带上"不动请求头"的最小请求体） */
async function save(payload: Record<string, unknown>) {
  return fx.app.inject({
    method: 'PUT',
    url: '/api/admin/mcp/services/ocr',
    payload: {
      description: 'OCR 识别服务',
      transport: 'http',
      url: OCR_URL,
      file_args: {},
      revision: await revision(),
      ...payload,
    },
  });
}

beforeEach(async () => {
  fx = await createFixture();
  fx.runtime.tools = [];
  fx.runtime.stats = { stats_available: true, items: [] };
  fx.mcpClient.toolsByService.set('ocr', TOOLS);
});

afterEach(async () => {
  await fx.cleanup();
});

describe('新建：请求头随创建落库，并随连接带下去', () => {
  it('门槛探测（连接一次）带上请求头明文——否则带令牌的服务只会回 401', async () => {
    await createService();
    expect(fx.mcpClient.lastTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });

  it('响应回显**掩码**：`6UuE…3Z`，且整条响应里不含明文令牌', async () => {
    const res = await createService();
    expect(res.statusCode).toBe(201);
    expect(res.json().headers).toEqual({ 'X-MCP-Token': MASKED });
    expect(res.body).not.toContain(TOKEN);
  });

  it('未带请求头 → `{}`，列表 `has_headers=false`', async () => {
    await createService({ headers: {} });
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(list.json().items[0].has_headers).toBe(false);
    expect((await detail()).headers).toEqual({});
  });

  it('请求头写法非法 → 400，且**不落库**（列表里没有这条）', async () => {
    const res = await createService({ headers: { 'X Token': 'v' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(list.json().items).toEqual([]);
  });

  it('把掩码当值提交 → 400 且原因可读（防"令牌被静默换成掩码"）', async () => {
    const res = await createService({ headers: { 'X-MCP-Token': MASKED } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('掩码');
  });
});

describe('列表与详情：只回掩码，不出现明文', () => {
  it('列表给 `has_headers` 布尔量，不给任何值（连掩码也不给）', async () => {
    await createService();
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    const item = list.json().items[0];
    expect(item.has_headers).toBe(true);
    expect(item.headers).toBeUndefined();
    expect(list.body).not.toContain(TOKEN);
  });

  it('详情回显掩码；获取工具清单时把明文请求头传给客户端（否则清单取不到）', async () => {
    await createService();
    const body = await detail();
    expect(body.headers).toEqual({ 'X-MCP-Token': MASKED });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(fx.mcpClient.lastTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });
});

describe('保存调用配置：缺省沿用 / 提供替换 / 空对象清空', () => {
  it('**不携带 `headers` → 沿用存量**（保存不会顺手清空令牌）', async () => {
    await createService();
    const res = await save({ description: 'OCR（改）' });
    expect(res.statusCode).toBe(200);
    expect(res.json().headers).toEqual({ 'X-MCP-Token': MASKED });

    // 明文仍在：用"测试"这条要求服务端按已保存请求头连接的路径来验证
    fx.mcpClient.probe = { connectivity: true, capability: true };
    await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(fx.mcpClient.lastTestTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });

  it('携带新值 → 整体替换（响应即掩码，明文不进响应）', async () => {
    await createService();
    const next = 'NEW-TOKEN-abcdefghij';
    const res = await save({ headers: { 'X-MCP-Token': next, 'X-Trace': 'abc' } });
    expect(res.statusCode).toBe(200);
    // **每个值都掩码**（含看起来不像密钥的短值）：平台无从判断哪个头是凭据，
    // 按"保守即安全"一律掩掉；短值整串掩成占位符
    expect(res.json().headers).toEqual({ 'X-MCP-Token': 'NEW-…ij', 'X-Trace': '••••' });
    expect(res.body).not.toContain(next);
    expect(res.body).not.toContain('abc');
  });

  it('携带 `{}` → 清空全部请求头（列表徽标随之消失）', async () => {
    await createService();
    const res = await save({ headers: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().headers).toEqual({});
    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(list.json().items[0].has_headers).toBe(false);
  });

  it('携带掩码 → 400，且**整条不生效**（原令牌未被覆盖）', async () => {
    await createService();
    const res = await save({ headers: { 'X-MCP-Token': MASKED } });
    expect(res.statusCode).toBe(400);

    fx.mcpClient.probe = { connectivity: true, capability: true };
    await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(fx.mcpClient.lastTestTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });

  it('stdio 传输丢弃请求头（请求头是 HTTP 的概念）', async () => {
    const res = await createService({
      transport: 'stdio',
      url: undefined,
      command: 'python',
      headers: { 'X-MCP-Token': TOKEN },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().headers).toEqual({});
  });
});

describe('测试（§3.6）与探测（§3.9）', () => {
  it('测试：body 带请求头 → 按表单当前值连', async () => {
    await createService();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'http', url: OCR_URL, headers: { 'X-MCP-Token': 'form-token-12345' } },
    });
    expect(res.statusCode).toBe(200);
    expect(fx.mcpClient.lastTestTarget?.headers).toEqual({ 'X-MCP-Token': 'form-token-12345' });
    // 请求头是凭据：测试回显的 target 里 MUST NOT 出现它（连掩码也不给）
    expect(JSON.stringify(res.json().target)).not.toContain('token');
  });

  it('测试：body 不带请求头 → 回落到已保存的（界面手上只有掩码）', async () => {
    await createService();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'http', url: 'http://192.168.1.9:9999/mcp' },
    });
    expect(fx.mcpClient.lastTestTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });

  it('探测：未登记目标带请求头 → 透传（新建流程第一步要用）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/probe',
      payload: {
        name: 'raw_inventory_purchase_function',
        transport: 'http',
        url: 'http://127.0.0.1:8021/mcp',
        headers: { 'X-MCP-Token': TOKEN },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(fx.mcpClient.lastTarget?.headers).toEqual({ 'X-MCP-Token': TOKEN });
  });

  it('探测：请求头写法非法 → 400（表单校验该拦住的问题）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/probe',
      payload: {
        transport: 'http',
        url: 'http://127.0.0.1:8021/mcp',
        headers: ['X-MCP-Token'],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});
