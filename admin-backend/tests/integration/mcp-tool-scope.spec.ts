/**
 * 集成测试：MCP 服务的**工具白名单**（2026-10-03，契约 §3.2 / §3.3 / §3.9）
 *
 * 覆盖：
 * - `POST /api/admin/mcp/probe`：新建前的工具清单探测（未登记目标；失败 `ok:false` 不抛错）；
 * - `POST /api/admin/mcp/services`：**连不上即创建失败且不落盘**、白名单必填非空；
 * - `PUT /api/admin/mcp/services/{name}`：**白名单不可二次调整**；
 * - `GET .../{name}`：详情只呈现白名单里的工具，缺失项进 `missing_tools`。
 *
 * 自 `mcp.spec.ts` 独立成文件：该文件已接近 500 行门禁（原则二）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

const OCR_URL = 'http://192.168.1.2:8000/mcp';

const CATALOG = [
  { name: 'ocr_image', description: '识别图片文字', parameters: { type: 'object' } },
  { name: 'ocr_pdf', description: '识别 PDF', parameters: { type: 'object' } },
  { name: 'query_price', description: '查价', parameters: { type: 'object' } },
];

const BASICS = {
  description: 'OCR 识别服务',
  transport: 'http',
  url: OCR_URL,
};

async function createService(name = 'ocr', overrides: Record<string, unknown> = {}) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/mcp/services',
    payload: { name, ...BASICS, allowed_tools: ['ocr_image'], ...overrides },
  });
}

function probe(payload: Record<string, unknown>) {
  return fx.app.inject({ method: 'POST', url: '/api/admin/mcp/probe', payload });
}

/** 库内是否真的没有该服务（"创建失败不落盘"的断言用） */
async function serviceNames(): Promise<string[]> {
  const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services' });
  return res.json().items.map((item: { name: string }) => item.name);
}

beforeEach(async () => {
  fx = await createFixture();
  fx.mcpClient.toolsByService.set('ocr', CATALOG);
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/mcp/probe（§3.9 新建前探测）', () => {
  it('连得上 → 200 + ok:true + 工具清单（不要求服务已登记）', async () => {
    const res = await probe({ name: 'ocr', ...BASICS });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.error).toBeNull();
    expect(body.tools.map((t: { name: string }) => t.name)).toEqual([
      'ocr_image',
      'ocr_pdf',
      'query_price',
    ]);
    expect(body.target).toMatchObject({ transport: 'http', url: OCR_URL });
    // 只是探测，**不落盘**
    expect(await serviceNames()).toEqual([]);
  });

  it('连不上 → 200 + ok:false + 可读原因（失败留在弹窗里，不是页级报错）', async () => {
    fx.mcpClient.failListTools.add('ocr');
    const res = await probe({ name: 'ocr', ...BASICS });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
    expect(res.json().tools).toEqual([]);
    expect(res.json().error).toContain('不可达');
    expect(res.json().error_code).toBe('ADM_RUNTIME_UNREACHABLE');
  });

  it('目标写法非法（transport 不认识）→ 400 VALIDATION_FAILED', async () => {
    const res = await probe({ name: 'ocr', transport: 'carrier-pigeon', url: OCR_URL });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/admin/mcp/services（§3.3 新建）', () => {
  it('缺 allowed_tools / 空数组 → 400，且不落盘', async () => {
    for (const allowed of [undefined, []]) {
      const res = await createService('svc', { allowed_tools: allowed });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
    expect(await serviceNames()).toEqual([]);
  });

  it('连不上 → 创建失败（503 ADM_RUNTIME_UNREACHABLE），且**库里不留记录**', async () => {
    fx.mcpClient.failListTools.add('ocr');
    const res = await createService();

    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('ADM_RUNTIME_UNREACHABLE');
    expect(await serviceNames()).toEqual([]);
  });

  it('连得上 → 201，响应回显白名单；详情只呈现白名单里的工具', async () => {
    const created = await createService('ocr', { allowed_tools: ['query_price', 'ocr_image'] });
    expect(created.statusCode).toBe(201);
    expect(created.json().allowed_tools).toEqual(['query_price', 'ocr_image']);

    const detail = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(detail.json().allowed_tools).toEqual(['query_price', 'ocr_image']);
    expect(detail.json().tools.map((t: { name: string }) => t.name)).toEqual([
      'query_price',
      'ocr_image',
    ]);
    expect(detail.json().missing_tools).toEqual([]);
  });
});

describe('PUT /api/admin/mcp/services/{name}（§3.3 保存调用配置）', () => {
  it('携带 allowed_tools → 409 ADM_MCP_TOOL_SCOPE_LOCKED，且白名单不变', async () => {
    await createService('ocr', { allowed_tools: ['ocr_image'] });
    const detail = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });

    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        ...BASICS,
        confirmation: 'always',
        allowed_tools: ['ocr_pdf'],
        revision: detail.json().revision,
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_MCP_TOOL_SCOPE_LOCKED');

    const after = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(after.json().allowed_tools).toEqual(['ocr_image']);
    // 被拒的请求整条不生效（不是"只忽略白名单"）
    expect(after.json().confirmation).toBe('never');
  });

  it('不携带 allowed_tools → 正常保存，且白名单原样保留', async () => {
    await createService('ocr', { allowed_tools: ['ocr_image', 'query_price'] });
    const detail = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });

    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: { ...BASICS, confirmation: 'always', revision: detail.json().revision },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().confirmation).toBe('always');
    expect(res.json().allowed_tools).toEqual(['ocr_image', 'query_price']);
  });
});

describe('白名单失效（工具下架/改名）', () => {
  it('白名单里有服务当前不存在的工具 → 详情进 missing_tools（界面标异常）', async () => {
    await createService('ocr', { allowed_tools: ['ocr_image', 'gone_tool'] });

    const detail = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(detail.json().tools.map((t: { name: string }) => t.name)).toEqual(['ocr_image']);
    expect(detail.json().missing_tools).toEqual(['gone_tool']);
  });

  it('服务不可达 → 不误报：missing 为空，用 tools_error 表达"核对不了"', async () => {
    await createService('ocr', { allowed_tools: ['ocr_image', 'gone_tool'] });
    fx.mcpClient.failListTools.add('ocr');

    const detail = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(detail.json().missing_tools).toEqual([]);
    expect(detail.json().tools_error).toContain('不可达');
  });
});
