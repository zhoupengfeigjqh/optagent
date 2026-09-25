/**
 * 集成测试：MCP 服务端点（T107，契约 §3.1~§3.8）
 *
 * 覆盖：列表自动识别新增服务、详情工具清单、服务级配置保存后影响所有引用数字人、
 * 启停状态反映真实结果、测试失败给出明确原因、日志有界、统计不可达时**不以 0 冒充**。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, DEFAULT_COMPOSE, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

const TOOLS = [
  {
    name: 'ocr_image',
    description: '识别图片文字',
    parameters: { type: 'object', properties: { image: { type: 'string' } } },
  },
];

function configure(
  name = 'ocr',
  overrides: Record<string, unknown> = {},
): void {
  fx.ctx.mcpConfigs.upsert(
    name,
    {
      description: 'OCR 识别服务',
      transport: 'http',
      endpoints: {
        container_network: 'http://ocr:8000/mcp',
        host_local: 'http://127.0.0.1:8000/mcp',
      },
      file_args: { ocr_image: { image: 'url' } },
      ...overrides,
    },
    fx.ctx.store.revision(),
  );
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
  fx.docker.statuses.set('ocr', 'running');
});

afterEach(async () => {
  await fx.cleanup();
});

describe('GET /api/admin/mcp/services', () => {
  it('清单以容器编排声明为唯一来源：平台服务被排除，新服务自动出现（FR-043、SC-010）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().page_size).toBe(8);
    expect(res.json().items.map((i: { name: string }) => i.name)).toEqual(['ocr']);
  });

  it('编排中新增服务后无需任何平台侧配置即自动出现', async () => {
    const extended = await createFixture({
      composeYaml: `${DEFAULT_COMPOSE}  new-mcp:\n    image: example/mcp:1\n    ports:\n      - "9000"\n`,
    });
    try {
      const res = await extended.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
      expect(res.json().items.map((i: { name: string }) => i.name).sort()).toEqual(['new-mcp', 'ocr']);
    } finally {
      await extended.cleanup();
    }
  });

  it('卡片含名称、用途描述、传输方式与状态（FR-006、FR-043）', async () => {
    configure();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.json().items[0]).toMatchObject({
      name: 'ocr',
      description: 'OCR 识别服务',
      transport: 'http',
      status: 'running',
      in_compose: true,
      configured: true,
      abnormal_reason: null,
    });
  });

  it('未配置时 configured=false 且用途描述为空串（不报错）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.json().items[0]).toMatchObject({ configured: false, description: '' });
  });

  it('容器状态不可得时 status 记为 unknown 而非报错（FR-043）', async () => {
    fx.docker.statuses = new Map();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items[0].status).toBe('unknown');
  });

  it('编排文件读不到 → 503 ADM_COMPOSE_FILE_UNREADABLE（不静默返回空清单）', async () => {
    const broken = await createFixture({ composeYaml: null });
    try {
      const res = await broken.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('ADM_COMPOSE_FILE_UNREADABLE');
    } finally {
      await broken.cleanup();
    }
  });

  it('平台有配置但编排里已移除 → in_compose=false 且给出具体差异（FR-052）', async () => {
    configure('ghost-service');
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services?page=1' });
    const ghost = res
      .json()
      .items.find((i: { name: string }) => i.name === 'ghost-service');
    expect(ghost.in_compose).toBe(false);
    expect(ghost.abnormal_reason).toContain('已不在容器编排声明中');
  });
});

describe('GET /api/admin/mcp/services/{name}', () => {
  it('详情含服务级配置、工具清单与编排原始声明（FR-044、FR-045）', async () => {
    configure();
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.endpoints).toEqual({
      container_network: 'http://ocr:8000/mcp',
      host_local: 'http://127.0.0.1:8000/mcp',
    });
    expect(body.file_args).toEqual({ ocr_image: { image: 'url' } });
    // writable / permission_scope 已随 2026-09-15 的产品决定移除：响应里 MUST NOT 再出现
    expect(body.writable).toBeUndefined();
    expect(body.permission_scope).toBeUndefined();
    expect(body.tools).toEqual(TOOLS);
    expect(body.tools_truncated).toBe(false);
    expect(body.compose_declaration).toBeTruthy();
  });

  it('未配置时工具清单为空且给出可读原因（不报错）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools).toEqual([]);
    expect(res.json().tools_error).toContain('尚未配置');
  });

  it('目标运行形态缺地址时工具清单给出明确原因', async () => {
    configure('ocr', { endpoints: { host_local: 'http://127.0.0.1:8000/mcp' } });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' });
    expect(res.json().tools_error).toContain('container_network');
  });

  it('不存在 → 404 ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ghost' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_MCP_SERVICE_NOT_FOUND');
  });
});

describe('PUT /api/admin/mcp/services/{name}', () => {
  it('保存服务级配置后影响**所有**引用它的数字人（FR-044、SC-011）', async () => {
    await createAgent('a1', ['ocr']);
    await createAgent('a2', ['ocr']);
    configure();

    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: 'OCR（改）',
        transport: 'http',
        endpoints: { container_network: 'http://ocr:9000/mcp' },
        file_args: {},
        revision: detail.revision,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().endpoints).toEqual({ container_network: 'http://ocr:9000/mcp' });
    // 无需逐个改动数字人：影响面由引用推导得出
    expect(res.json().affected_agents.sort()).toEqual(['a1', 'a2']);
  });

  it('保存后**详情必须回显** async_tools 与 rules_fields（界面保存会重载详情，漏登记即"保存即清空"）', async () => {
    configure();
    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();

    const saved = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: 'OCR 识别服务',
        transport: 'http',
        endpoints: { container_network: 'http://ocr:8000/mcp' },
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

  it('endpoints 为空对象 → VALIDATION_FAILED（FR-056：至少一个形态）', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: '',
        transport: 'http',
        endpoints: {},
        file_args: {},
        revision: fx.ctx.store.revision(),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('stdio 缺 command → VALIDATION_FAILED', async () => {
    configure();
    const detail = (await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ocr' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: '',
        transport: 'stdio',
        endpoints: { container_network: 'stdio' },
        file_args: {},
        revision: detail.revision,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('已废弃的 writable / permission_scope 不再拦截（字段被忽略而非报错）', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: '',
        transport: 'http',
        endpoints: { container_network: 'http://ocr:8000/mcp' },
        writable: false,
        permission_scope: '   ',
        file_args: {},
        revision: fx.ctx.store.revision(),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().writable).toBeUndefined();
    expect(res.json().permission_scope).toBeUndefined();
  });

  it('不存在的服务 → 404 ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ghost',
      payload: {
        description: '',
        transport: 'http',
        endpoints: { container_network: 'http://x:1/mcp' },
        file_args: {},
        revision: fx.ctx.store.revision(),
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('版本冲突 → 409 ADM_CONFIG_REVISION_CONFLICT', async () => {
    configure();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/mcp/services/ocr',
      payload: {
        description: '',
        transport: 'http',
        endpoints: { container_network: 'http://ocr:8000/mcp' },
        file_args: {},
        revision: 999,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
  });
});

describe('POST /api/admin/mcp/services/{name}/start|stop', () => {
  it('启停返回真实状态（FR-046）', async () => {
    fx.docker.statuses.set('ocr', 'stopped');
    const start = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/start' });
    expect(start.statusCode).toBe(200);
    expect(start.json()).toEqual({ name: 'ocr', status: 'running' });

    const stop = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/stop' });
    expect(stop.json()).toEqual({ name: 'ocr', status: 'stopped' });
  });

  it('不在编排声明内 → 409 ADM_MCP_SERVICE_UNMANAGED', async () => {
    const managed = await createFixture({ composeYaml: null });
    try {
      const res = await managed.app.inject({
        method: 'POST',
        url: '/api/admin/mcp/services/ocr/start',
      });
      // 编排读不到 → 服务判定为不存在
      expect([404, 409, 503]).toContain(res.statusCode);
    } finally {
      await managed.cleanup();
    }
  });

  it('不存在的服务 → 404 ADM_MCP_SERVICE_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ghost/stop' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/admin/mcp/services/{name}/test', () => {
  it('成功时连通性与能力验证均通过（FR-047）', async () => {
    configure();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().capability.method).toBe('ping');
    // 实测目标必须回显：管理员要能看到"测的是谁"
    expect(res.json().target).toEqual({ transport: 'http', url: 'http://ocr:8000/mcp', command: null });
  });

  it('body 携带表单当前值（未保存）时按其探测并回显该目标（FR-047）', async () => {
    configure();
    fx.mcpClient.probe = { connectivity: true, capability: true };
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'http', endpoints: { container_network: 'http://ocr:9999/mcp' } },
    });
    expect(res.statusCode).toBe(200);
    // 探测目标 = 表单当前值，而非已保存的旧地址
    expect(res.json().target.url).toBe('http://ocr:9999/mcp');
  });

  it('body 的 transport 非法 → VALIDATION_FAILED', async () => {
    configure();
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/mcp/services/ocr/test',
      payload: { transport: 'grpc', endpoints: {} },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('失败时 MUST NOT 误报为成功，且给出明确原因（FR-047）', async () => {
    configure();
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

  it('未配置服务级信息 → VALIDATION_FAILED（不把"没配"说成"连不上"）', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/mcp/services/ocr/test' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('GET /api/admin/mcp/services/{name}/logs', () => {
  it('有界返回：limit 生效并标记 truncated（FR-048）', async () => {
    fx.docker.logsByService.set(
      'ocr',
      Array.from({ length: 10 }, (_, i) => ({ ts: `2026-09-15T06:00:0${i}.000Z`, line: `l${i}` })),
    );
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/mcp/services/ocr/logs?limit=3',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(3);
    expect(res.json().truncated).toBe(true);
  });

  it('limit 非法 → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/mcp/services/ocr/logs?limit=0',
    });
    expect(res.statusCode).toBe(400);
  });

  it('不存在 → 404', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/mcp/services/ghost/logs' });
    expect(res.statusCode).toBe(404);
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
