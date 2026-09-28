/**
 * 集成测试：MCP 服务端点（契约 §3.1~§3.6）
 *
 * **2026-09-27 改版（全人工配置）**：清单来源为**平台侧新建的服务**；
 * 覆盖：新建/重名/非法名、详情工具清单、保存后影响所有引用数字人、
 * 删除、测试失败给出明确原因、统计不可达时**不以 0 冒充**。
 * 启停与运行日志端点已下架（不再读容器运行态）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

const TOOLS = [
  {
    name: 'ocr_image',
    description: '识别图片文字',
    parameters: { type: 'object', properties: { image: { type: 'string' } } },
  },
];

const OCR_URL = 'http://192.168.1.2:8000/mcp';

/** 通过接口新建一个服务（走真实路由，而不是直接调 domain） */
async function createService(name = 'ocr', overrides: Record<string, unknown> = {}) {
  return fx.app.inject({
    method: 'POST',
    url: '/api/admin/mcp/services',
    payload: {
      name,
      description: 'OCR 识别服务',
      transport: 'http',
      url: OCR_URL,
      file_args: { ocr_image: { image: 'url' } },
      ...overrides,
    },
  });
}

async function createAgent(name: string, mcpServices: string[]): Promise<void> {
  const res = await fx.app.inject({
    method: 'POST',
    url: '/api/admin/agents',
    payload: {
      name,
      soul: 'x',
      enabled_tools: [],
      mcp_services: mcpServices,
      skills: [],
      scenario: { scenario: 's', data_prep_dirs: ['算法规则'] },
    },
  });
  if (res.statusCode !== 201) throw new Error(res.body);
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

describe('POST /api/admin/mcp/services（新建）', () => {
  it('新建成功 → 201，且响应即"新建后的完整调用配置"', async () => {
    const res = await createService();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      name: 'ocr',
      description: 'OCR 识别服务',
      transport: 'http',
      url: OCR_URL,
      affected_agents: [],
    });
    expect(res.json().revision).toBeTypeOf('number');
  });

  it('重名 → 409 ADM_MCP_SERVICE_EXISTS', async () => {
    await createService();
    const again = await createService();
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ADM_MCP_SERVICE_EXISTS');
  });

  it('服务名非法（含空格 / 中文 / 空）→ 400 VALIDATION_FAILED', async () => {
    for (const name of ['', 'a b', '中文']) {
      const res = await createService(name);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    }
  });

  it('http 缺 url → 400 VALIDATION_FAILED', async () => {
    const res = await createService('ocr', { url: '' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toContain('url 必填');
  });
});

describe('GET /api/admin/mcp/services', () => {
  it('清单以平台配置为唯一来源：未新建时为空，新建后即出现（FR-043）', async () => {
    const empty = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().page_size).toBe(8);
    expect(empty.json().items).toEqual([]);

    await createService();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.json().items.map((i: { name: string }) => i.name)).toEqual(['ocr']);
  });

  it('卡片含名称、用途描述、传输方式与连接地址（FR-006、FR-043）', async () => {
    await createService();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.json().items[0]).toMatchObject({
      name: 'ocr',
      description: 'OCR 识别服务',
      transport: 'http',
      url: OCR_URL,
    });
    // 容器运行态相关字段已下架
    expect(res.json().items[0].status).toBeUndefined();
    expect(res.json().items[0].in_compose).toBeUndefined();
  });
});

describe('GET /api/admin/mcp/services/{name}', () => {
  it('详情含调用配置与工具清单（FR-044、FR-045）', async () => {
    await createService();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.url).toBe(OCR_URL);
    expect(body.file_args).toEqual({ ocr_image: { image: 'url' } });
    // writable / permission_scope 已随 2026-09-15 的产品决定移除：响应里 MUST NOT 再出现
    expect(body.writable).toBeUndefined();
    expect(body.permission_scope).toBeUndefined();
    // 编排原始声明已下架
    expect(body.compose_declaration).toBeUndefined();
    expect(body.tools).toEqual(TOOLS);
    expect(body.tools_truncated).toBe(false);
  });

  it('工具清单不可得时不报错，而是空清单 + 可读原因（FR-045 降级）', async () => {
    await createService();
    fx.mcpClient.failListTools.add('ocr');
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toEqual([]);
    expect(res.json().tools_error).toContain('不可达');
  });

  it('不存在 → 404 ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_MCP_SERVICE_NOT_FOUND');
  });
});

describe('PUT /api/admin/mcp/services/{name}', () => {
  it('保存调用配置后影响**所有**引用它的数字人（FR-044、SC-011）', async () => {
    await createService();
    await createAgent('a1', ['ocr']);
    await createAgent('a2', ['ocr']);

    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: 'OCR（改）',
        transport: 'http',
        url: 'http://192.168.1.3:9000/mcp',
        file_args: {},
        revision: detail.revision,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().url).toBe('http://192.168.1.3:9000/mcp');
    // 无需逐个改动数字人：影响面由引用推导得出
    expect(res.json().affected_agents.sort()).toEqual(['a1', 'a2']);
  });

  it('保存后**详情必须回显** async_tools 与 rules_fields（界面保存会重载详情，漏登记即"保存即清空"）', async () => {
    await createService();
    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();

    const saved = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: 'OCR 识别服务',
        transport: 'http',
        url: OCR_URL,
        file_args: { ocr_image: { image: 'url' } },
        rules_fields: { ocr_image: 'input.rules' },
        async_tools: ['ocr_image'],
        revision: detail.revision,
      },
    });
    expect(saved.statusCode).toBe(200);
    // 保存响应本身 = "保存后的完整调用配置"（契约 §3.3）
    expect(saved.json().async_tools).toEqual(['ocr_image']);
    expect(saved.json().rules_fields).toEqual({ ocr_image: 'input.rules' });

    // 关键路径：界面在保存成功后会 `loadDetail()` 覆盖表单——详情漏登记这两个字段，
    // 表现就是"保存成功、勾选却被清空"（2026-09-26 实测缺陷）
    const after = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    expect(after.async_tools).toEqual(['ocr_image']);
    expect(after.rules_fields).toEqual({ ocr_image: 'input.rules' });
  });

  it('stdio 缺 command → VALIDATION_FAILED', async () => {
    await createService();
    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: { description: '', transport: 'stdio', revision: detail.revision },
    });
    expect(res.statusCode).toBe(400);
  });

  it('已废弃的 writable / permission_scope 不再拦截（字段被忽略而非报错）', async () => {
    await createService();
    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: '',
        transport: 'http',
        url: OCR_URL,
        writable: false,
        permission_scope: '   ',
        file_args: {},
        revision: detail.revision,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().writable).toBeUndefined();
    expect(res.json().permission_scope).toBeUndefined();
  });

  it('不存在的服务 → 404 ADM_MCP_SERVICE_NOT_FOUND（新建必须走 POST）', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ghost',
      payload: {
        description: '',
        transport: 'http',
        url: 'http://x:1/mcp',
        file_args: {},
        revision: fx.ctx.store.revision(),
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_MCP_SERVICE_NOT_FOUND');
  });

  it('版本冲突 → 409 ADM_CONFIG_REVISION_CONFLICT', async () => {
    await createService();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: { description: '', transport: 'http', url: OCR_URL, file_args: {}, revision: 999 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
  });
});

describe('DELETE /api/admin/mcp/services/{name}', () => {
  it('删除后清单里不再出现（204）', async () => {
    await createService();
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/mcp/services/ocr' });
    expect(res.statusCode).toBe(204);

    const list = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(list.json().items).toEqual([]);
  });

  it('删除被引用的服务后，该数字人的引用变为失效（由引用有效性判定）', async () => {
    await createService();
    await createAgent('a1', ['ocr']);
    await fx.app.inject({ method: 'DELETE', url: '/api/admin/mcp/services/ocr' });

    const anomalies = await fx.app.inject({ method: 'GET', url: '/api/admin/anomalies' });
    expect(anomalies.json().items[0]).toMatchObject({ category: 'mcp_service', target_name: 'ocr' });
  });

  it('不存在 → 404 ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/mcp/services/ghost' });
    expect(res.statusCode).toBe(404);
  });
});

describe('已下架的容器运维端点', () => {
  it('start / stop / logs 一律 404（平台不再读容器运行态）', async () => {
    await createService();
    const cases = [
      { method: 'POST' as const, url: '/api/admin/mcp/services/ocr/start' },
      { method: 'POST' as const, url: '/api/admin/mcp/services/ocr/stop' },
      { method: 'GET' as const, url: '/api/admin/mcp/services/ocr/logs' },
    ];
    for (const c of cases) {
      const res = await fx.app.inject(c);
      expect(res.statusCode).toBe(404);
    }
  });
});

describe('POST /api/admin/mcp/services/{name}/test', () => {
  it('成功时连通性与能力验证均通过（FR-047）', async () => {
    await createService();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().capability.method).toBe('ping');
    // 实测目标必须回显：管理员要能看到"测的是谁"
    expect(res.json().target).toEqual({ transport: 'http', url: OCR_URL, command: null });
  });

  it('body 携带表单当前值（未保存）时按其探测并回显该目标（FR-047）', async () => {
    await createService();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'http', url: 'http://192.168.1.9:9999/mcp' },
    });
    expect(res.statusCode).toBe(200);
    // 探测目标 = 表单当前值，而非已保存的旧地址
    expect(res.json().target.url).toBe('http://192.168.1.9:9999/mcp');
  });

  it('body 的 transport 非法 → VALIDATION_FAILED', async () => {
    await createService();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'grpc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('失败时 MUST NOT 误报为成功，且给出明确原因（FR-047）', async () => {
    await createService();
    fx.mcpClient.probe = { connectivity: false, capability: false };
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.connectivity.ok).toBe(false);
    expect(body.connectivity.error_code).toBe('MCP_CONNECTION_REFUSED');
    expect(body.connectivity.message).toBeTruthy();
    expect(body.capability.ok).toBe(false);
  });

  it('服务不存在 → 404（不把"没建"说成"连不上"）', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ghost/test' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_MCP_SERVICE_NOT_FOUND');
  });
});

describe('GET /api/admin/mcp/stats', () => {
  it('可用时返回服务级汇总与分组行（FR-049）', async () => {
    fx.runtime.stats = {
      stats_available: true,
      items: [{ name: 'ocr', calls_total: 3, calls_ok: 3, calls_failed: 0, last_called_at: '2026-09-15T06:00:00Z' }],
      groups: [
        {
          service: 'ocr',
          tool_name: 'ocr_image',
          user_id: 'admin',
          calls_total: 3,
          calls_ok: 3,
          calls_failed: 0,
          last_called_at: '2026-09-15T06:00:00Z',
        },
      ],
    };
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/stats' });
    expect(res.json().stats_available).toBe(true);
    expect(res.json().items[0].calls_total).toBe(3);
    // 分组行原样透传（平台统计表的行）
    expect(res.json().groups[0].tool_name).toBe('ocr_image');
  });

  it('运行环境不可达时**不以 0 冒充**：stats_available=false 且两数组皆空（FR-009）', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ stats_available: false, items: [], groups: [] });
  });
});
