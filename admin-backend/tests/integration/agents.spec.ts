/**
 * 集成测试：数字人设计端点（T047，契约 §5.1~§5.5）
 *
 * 覆盖：新建 / 名称冲突 / 非法名 / SOUL 空拒绝 / 清单外引用拒绝 /
 * 原样回显（含换行与标点）/ 删除阻止 / 404 / 版本冲突 / 分页。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';
import { soulDesign } from '../helpers/soul.js';

const TOOL_FIXTURE = [
  {
    name: 'read_file',
    label: '读取文件',
    description_template: '如 "{示例路径}"',
    parameters: { type: 'object' },
    writable: false,
  },
  {
    name: 'write_file',
    label: '写入临时文件',
    description_template: '以 "{会话标识}_" 开头',
    parameters: { type: 'object' },
    writable: true,
  },
];

let fx: TestFixture;

/** SOUL 主要使命：用例据此断言换行与标点被**原样保留**（004 起由 `mission` 承载） */
const SOUL_MISSION = '第一行：你是一名助手。\n第二行：含标点，！？\n\n第四行结束。';

const validBody = {
  name: 'demo',
  // 角色简介同时作为卡片"用途描述"的来源（004 起不再取 SOUL 首行）
  soul: soulDesign(SOUL_MISSION, { intro: '第一行：你是一名助手。' }),
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
};

/** 往平台本体库塞一个完整本体（两个必需文件齐备；`FR-058`） */
function installOntology(scenario = '生产调度', ontologyDir = '原材料采购和库存'): void {
  fx.ctx.ontologies.install({
    scenario,
    ontology_dir: ontologyDir,
    content: `metadata:
  created_at: '2026-07-15 16:05:02'
  deployed_version: v1.0
  scenario_name: ${scenario}
  scenario_id: 1
  ontology_name: ${ontologyDir}
  ontology_id: 1
concepts: []
`,
    securities: 'securities: []\n',
  });
}

beforeEach(async () => {
  // MCP 服务改为平台内人工新建：`validBody` 里引用的 `ocr` 必须先存在
  fx = await createFixture({ mcpServices: { ocr: {} } });
  fx.runtime.tools = TOOL_FIXTURE;
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/agents', () => {
  it('新建成功：返回完整设计态与 revision', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: validBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('demo');
    expect(body.enabled_tools).toEqual(['read_file']);
    expect(body.mcp_services).toEqual(['ocr']);
    expect(body.abnormal).toBe(false);
    expect(typeof body.revision).toBe('number');
  });

  it('本体引用随设计态保存并原样回显（FR-058，2026-10-17）', async () => {
    installOntology();

    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, ontologies: ['生产调度/原材料采购和库存'] },
    });
    expect(res.statusCode).toBe(201);
    // 只存引用不存正文：正文由部署物化时从库内取
    expect(res.json().ontologies).toEqual(['生产调度/原材料采购和库存']);
  });

  it('本体引用不在库内 → 400 ADM_AGENT_INVALID_REF', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, ontologies: ['不存在/本体'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ADM_AGENT_INVALID_REF');
  });

  it('名称冲突 → 409 ADM_AGENT_NAME_TAKEN', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: validBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_AGENT_NAME_TAKEN');
  });

  it('非法名称（含 "/"）→ ADM_AGENT_NAME_TAKEN', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, name: 'a/b' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_AGENT_NAME_TAKEN');
  });

  it('结构化 SOUL 的必填项为空 → 400 VALIDATION_FAILED（004）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, soul: soulDesign('   ') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('引用清单外的内置工具 / MCP / SKILL → 400 ADM_AGENT_INVALID_REF', async () => {
    const cases = [
      { ...validBody, name: 'a', enabled_tools: ['ghost'] },
      { ...validBody, name: 'b', mcp_services: ['ghost'] },
      { ...validBody, name: 'c', skills: ['ghost'] },
    ];
    for (const payload of cases) {
      const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('ADM_AGENT_INVALID_REF');
      expect(res.json().error.message).toContain('ghost');
    }
  });

  it('运行环境不可达且本次引用了内置工具 → 503 ADM_RUNTIME_UNREACHABLE（不误判为失效引用）', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, enabled_tools: ['read_file'] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('ADM_RUNTIME_UNREACHABLE');
  });

  it('运行环境不可达但不引用内置工具 → 仍可保存', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, enabled_tools: [] },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('GET /api/admin/agents/{name}', () => {
  it('原样回显：SOUL 的换行与标点、条目顺序均保持（FR-017）', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // 004：换行与标点仍**原样保留**，只是改由 `mission` 承载
    expect(body.soul.mission).toBe(SOUL_MISSION);
    expect(body.scenario.data_prep_dirs).toEqual(['生产计划', '算法规则']);
  });

  it('不存在 → 404 ADM_AGENT_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_AGENT_NOT_FOUND');
  });
});

describe('GET /api/admin/agents', () => {
  it('卡片列表含名称、用途描述（取自角色简介）与异常态', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents?page=1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.page_size).toBe(8);
    expect(body.items[0]).toMatchObject({
      name: 'demo',
      description: '第一行：你是一名助手。',
      abnormal: false,
    });
  });

  it('非法 page → 400 VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents?page=0' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('异常卡片可辨识且不影响其余卡片（FR-006、FR-013）', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, name: 'demo2', enabled_tools: [], mcp_services: [] },
    });
    // 工具目录被清空后，引用了 read_file 的 demo 变为异常卡片，而 demo2 不受影响
    fx.runtime.tools = [];
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents?page=1' });
    const items = res.json().items as Array<{
      name: string;
      abnormal: boolean;
      abnormal_reason: string | null;
    }>;
    const demo = items.find((i) => i.name === 'demo')!;
    expect(demo.abnormal).toBe(true);
    expect(demo.abnormal_reason).toContain('read_file');
    expect(items.find((i) => i.name === 'demo2')!.abnormal).toBe(false);
  });
});

describe('PUT /api/admin/agents/{name}', () => {
  it('保存后原样回显，revision 递增', async () => {
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody })
    ).json();
    const nextMission = '改后的 SOUL\n含换行、标点：！？';
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: { ...validBody, soul: soulDesign(nextMission), revision: created.revision },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().soul.mission).toBe(nextMission);
    expect(res.json().revision).toBeGreaterThan(created.revision);
  });

  it('缺 revision → 400 VALIDATION_FAILED', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: validBody,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('版本冲突 → 409 ADM_CONFIG_REVISION_CONFLICT 且内容不变', async () => {
    const created = (
      await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody })
    ).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: { ...validBody, soul: soulDesign('新内容'), revision: created.revision - 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    const after = (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).json();
    expect(after.soul).toEqual(validBody.soul);
  });

  it('改名冲突 → ADM_AGENT_NAME_TAKEN', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, name: 'demo2' },
    });
    const current = (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: { ...validBody, name: 'demo2', revision: current.revision },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_AGENT_NAME_TAKEN');
  });
});

describe('DELETE /api/admin/agents/{name}', () => {
  it('未被关联时删除成功（204）', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/demo' });
    expect(res.statusCode).toBe(204);
    expect((await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).statusCode).toBe(404);
  });

  it('被用户关联时阻止删除 → 409 ADM_AGENT_IN_USE 并指明用户（FR-021）', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    fx.ctx.users.create('admin', ['demo']);

    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/demo' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_AGENT_IN_USE');
    expect(res.json().error.message).toContain('admin');
  });

  it('不存在 → 404 ADM_AGENT_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/agents/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_AGENT_NOT_FOUND');
  });
});

describe('GET /api/admin/agents/catalog（§5.6，2026-10-17）', () => {
  it('一次返回全量候选：9 个 MCP 服务全部下发（卡片列表一页仍只有 8 条）', async () => {
    // 再补 8 个服务，与 beforeEach 预置的 `ocr` 一起凑满 9 个
    for (let index = 2; index <= 9; index += 1) {
      fx.ctx.mcpConfigs.create({
        name: `svc-${index}`,
        transport: 'http',
        url: `http://127.0.0.1:1/svc-${index}/mcp`,
        allowed_tools: ['ocr_image'],
      });
    }

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.builtin_tools.map((tool: { name: string }) => tool.name)).toEqual([
      'read_file',
      'write_file',
    ]);
    expect(body.builtin_tools_error).toBeNull();
    expect(body.mcp_services).toHaveLength(9);
    expect(body.skills).toEqual([]);
    expect(body.ontologies).toEqual([]);

    // 对照：同一时刻的卡片列表仍是一页 8 条——catalog 不是把分页改大
    const paged = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/mcp/services?page=1',
    });
    expect(paged.json().items).toHaveLength(8);
    expect(paged.json().total).toBe(9);
  });

  it('本体候选随目录下发：身份 + metadata，不含两个文件的正文', async () => {
    installOntology();
    installOntology('生产调度', '工艺路线');

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/catalog' });
    expect(res.statusCode).toBe(200);
    const items = res.json().ontologies as Array<Record<string, unknown>>;

    expect(items).toHaveLength(2);

    // 候选就是 `{ metadata }`：身份只有一份来源，不再下发 scenario / ontology_dir / name
    const metaOf = (item: Record<string, unknown>) => item.metadata as Record<string, unknown>;
    expect(items.map((item) => `${metaOf(item).scenario_name as string}/${metaOf(item).ontology_name as string}`)).toEqual(
      expect.arrayContaining(['生产调度/原材料采购和库存', '生产调度/工艺路线']),
    );

    const picked = items.find((item) => metaOf(item).ontology_name === '原材料采购和库存');
    expect(metaOf(picked!).scenario_name).toBe('生产调度');
    expect(picked).not.toHaveProperty('content');
    expect(picked).not.toHaveProperty('securities_content');
  });

  it('内置工具不可达 → 只清空工具并带回原因，MCP 候选照常返回', async () => {
    fx.runtime.unreachable = true;

    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.builtin_tools).toEqual([]);
    expect(body.builtin_tools_error).toContain('运行环境不可达');
    expect(body.mcp_services.map((service: { name: string }) => service.name)).toEqual(['ocr']);
  });
});
