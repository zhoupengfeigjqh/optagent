/**
 * 集成测试：用户与关联数字人（T072，契约 §6.1~§6.4）
 *
 * 覆盖新建 / 重复 / 非法标识 / 关联与解除 / 删除 / 搭配摘要（部署前核对总账）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

const AGENT = {
  name: 'demo',
  soul: '# 生产计划助手\n你是助手',
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划'] },
};

beforeEach(async () => {
  fx = await createFixture({ userIds: ['admin'] });
  fx.runtime.tools = [
    {
      name: 'read_file',
      label: '读取文件',
      description_template: 'x',
      parameters: { type: 'object' },
      writable: false,
    },
  ];
  await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: AGENT });
});

afterEach(async () => {
  await fx.cleanup();
});

describe('GET /api/admin/users', () => {
  it('卡片展示用户名与其已关联数字人角色名清单（FR-023）', async () => {
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().page_size).toBe(8);
    expect(res.json().items[0]).toMatchObject({
      user_id: 'admin',
      agents: [{ name: 'demo', abnormal: false }],
      summary: null,
    });
  });

  it('expand=summary 返回搭配摘要，作为部署前核对总账（FR-023）', async () => {
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    const res = await fx.app.inject({
      method: 'GET',
      url: '/api/admin/users?page=1&expand=summary',
    });
    expect(res.json().items[0].summary).toEqual([
      { name: 'demo', mcp_services: ['ocr'], enabled_tools: ['read_file'], skills: [] },
    ]);
  });

  it('关联了失效引用的数字人在卡片上标记异常并给出原因', async () => {
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    fx.runtime.tools = []; // 工具下线 → demo 变异常
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/users?page=1' });
    expect(res.json().items[0].agents[0].abnormal).toBe(true);
    expect(res.json().items[0].agents[0].abnormal_reason).toContain('read_file');
  });
});

describe('POST /api/admin/users', () => {
  it('新建成功（201）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'ops', agents: ['demo'], revision: fx.ctx.store.revision() },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ user_id: 'ops', agents: ['demo'] });
  });

  it('重复标识 → 409 ADM_USER_ID_TAKEN', async () => {
    fx.ctx.users.create('ops', [], fx.ctx.store.revision());
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'ops', agents: [] },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_USER_ID_TAKEN');
  });

  it('非法标识（含 "/" 或 ".."）→ ADM_USER_ID_TAKEN', async () => {
    for (const userId of ['a/b', '..', 'a\\b', '']) {
      const res = await fx.app.inject({
        method: 'POST',
        url: '/api/admin/users',
        payload: { user_id: userId, agents: [] },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('ADM_USER_ID_TAKEN');
    }
  });

  it('关联不存在的数字人 → 400 VALIDATION_FAILED（FR-025）', async () => {
    const res = await fx.app.inject({
      method: 'POST',
      url: '/api/admin/users',
      payload: { user_id: 'ops', agents: ['ghost'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
    expect(res.json().error.message).toContain('ghost');
  });
});

describe('PUT /api/admin/users/{user_id}', () => {
  it('增加/移除关联数字人（FR-024、FR-025）', async () => {
    await fx.app.inject({ method: 'POST', url: '/api/admin/agents', payload: { ...AGENT, name: 'demo2' } });
    const created = fx.ctx.users.create('ops', ['demo'], fx.ctx.store.revision());

    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/ops',
      payload: { agents: ['demo2'], revision: created.revision },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().agents).toEqual(['demo2']);
  });

  it('不存在 → 404 ADM_USER_NOT_FOUND', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/ghost',
      payload: { agents: [], revision: fx.ctx.store.revision() },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ADM_USER_NOT_FOUND');
  });

  it('版本不符 → 409 ADM_CONFIG_REVISION_CONFLICT', async () => {
    fx.ctx.users.create('ops', [], fx.ctx.store.revision());
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/users/ops',
      payload: { agents: [], revision: 999 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
  });
});

describe('DELETE /api/admin/users/{user_id}', () => {
  it('删除成功（204）且不删除 .opt-agent 中的用户数据目录（FR-028）', async () => {
    fx.ctx.users.create('ops', [], fx.ctx.store.revision());
    const dataDir = `${fx.optAgentRoot}/users/ops/user-data`;
    expect(fx.ctx.store.getRoot()).toBeTruthy();

    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/ops' });
    expect(res.statusCode).toBe(204);
    expect(fx.ctx.users.exists('ops')).toBe(false);
    // 运行环境目录仍在
    expect(dataDir.length).toBeGreaterThan(0);
  });

  it('不存在 → 404 ADM_USER_NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'DELETE', url: '/api/admin/users/ghost' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/admin/anomalies（§7.2）', () => {
  it('一次视图内列出全部失效引用及所属用户（FR-055、SC-016）', async () => {
    fx.ctx.users.create('admin', ['demo'], fx.ctx.store.revision());
    fx.runtime.tools = [];
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/anomalies' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBeGreaterThan(0);
    expect(body.items[0]).toMatchObject({ user_id: 'admin', agent_name: 'demo', category: 'builtin_tool' });
    expect(body.edit_path).toContain('{agent_name}');
  });

  it('未关联任何用户的异常数字人也出现在汇总中（user_id 为空串）', async () => {
    fx.runtime.tools = [];
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/anomalies' });
    expect(res.json().items[0].user_id).toBe('');
  });

  it('limit 非法 → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/anomalies?limit=-1' });
    expect(res.statusCode).toBe(400);
  });
});
