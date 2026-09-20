/**
 * 集成测试：数字人设计端点（T047，契约 §5.1~§5.5）
 *
 * 覆盖：新建 / 名称冲突 / 非法名 / SOUL 空拒绝 / 清单外引用拒绝 /
 * 原样回显（含换行与标点）/ 删除阻止 / 404 / 版本冲突 / 分页。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

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

const validBody = {
  name: 'demo',
  soul: '第一行：你是一名助手。\n第二行：含标点，！？\n\n第四行结束。',
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划', '算法规则'] },
};

beforeEach(async () => {
  fx = await createFixture();
  fx.runtime.tools = TOOL_FIXTURE;
});

afterEach(async () => {
  await fx.cleanup();
});

describe('POST /api/admin/agents', () => {
  it('新建成功：返回完整设计态与 revision', async () => {
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('demo');
    expect(body.enabled_tools).toEqual(['read_file']);
    expect(body.mcp_services).toEqual(['ocr']);
    expect(body.abnormal).toBe(false);
    expect(typeof body.revision).toBe('number');
  });

  it('名称冲突 → 409 ADM_AGENT_NAME_TAKEN', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
    const res = await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: validBody });
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

  it('SOUL 为空 → 400 VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/agents',
      payload: { ...validBody, soul: '   ' },
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
    expect(body.soul).toBe(validBody.soul);
    expect(body.scenario.data_prep_dirs).toEqual(['生产计划', '算法规则']);
  });

  it('不存在 → 404 ADM_AGENT_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/agents/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_AGENT_NOT_FOUND');
  });
});

describe('GET /api/admin/agents', () => {
  it('卡片列表含名称、用途描述（取自 SOUL 首行）与异常态', async () => {
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
    const items = res.json().items as Array<{ name: string; abnormal: boolean; abnormal_reason: string | null }>;
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
    const nextSoul = '改后的 SOUL\n含换行、标点：！？\n';
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/agents/demo',
      payload: { ...validBody, soul: nextSoul, revision: created.revision },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().soul).toBe(nextSoul);
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
      payload: { ...validBody, soul: '新内容', revision: created.revision - 1 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    const after = (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).json();
    expect(after.soul).toBe(validBody.soul);
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
    expect(
      (await fx.app.inject({ method: 'GET', url: '/api/admin/agents/demo' })).statusCode,
    ).toBe(404);
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
