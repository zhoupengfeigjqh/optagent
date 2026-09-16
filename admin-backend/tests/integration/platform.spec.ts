/**
 * 集成测试：平台级端点（T024，契约 §1.1~§1.4）
 *
 * MUST 覆盖每个端点的正常路径与错误码（宪章原则三）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

beforeEach(async () => {
  fx = await createFixture();
});

afterEach(async () => {
  await fx.cleanup();
});

describe('GET /api/admin/platform/health', () => {
  it('一次性给出四类外部依赖的可达性与当前运行形态', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.platform_data).toEqual({ writable: true, path: fx.platformDataDir });
    expect(body.opt_agent.readable).toBe(true);
    expect(body.opt_agent.writable).toBe(true);
    expect(body.opt_agent.path).toBe(fx.optAgentRoot);
    expect(body.compose_file).toEqual({ readable: true, path: fx.composeFilePath });
    expect(body.docker).toEqual({ available: true });
    expect(body.runtime_form).toBe('container_network');
  });

  it('编排文件缺失时以字段表达而非报错（便于一次看到全部问题）', async () => {
    const broken = await createFixture({ composeYaml: null });
    try {
      const res = await broken.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().compose_file.readable).toBe(false);
    } finally {
      await broken.cleanup();
    }
  });
});

describe('GET /api/admin/platform/settings', () => {
  it('返回目标运行形态与当前 revision', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ target_runtime_form: 'container_network', revision: 1 });
  });
});

describe('GET /api/admin/platform/runtime-forms', () => {
  it('列出两种形态供界面渲染（前端不硬编码，原则七）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/runtime-forms' });
    expect(res.statusCode).toBe(200);
    const values = res.json().items.map((i: { value: string }) => i.value);
    expect(values).toEqual(['container_network', 'host_local']);
  });
});

describe('PUT /api/admin/platform/settings', () => {
  it('切换形态成功并递增 revision，提示需重新部署（FR-057）', async () => {
    const before = (await fx.app.inject({ method: 'GET', url: '/api/admin/platform/settings' })).json();
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/platform/settings',
      payload: { target_runtime_form: 'host_local', revision: before.revision },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      target_runtime_form: 'host_local',
      revision: before.revision + 1,
      deploy_required: true,
    });

    const after = (await fx.app.inject({ method: 'GET', url: '/api/admin/platform/settings' })).json();
    expect(after.target_runtime_form).toBe('host_local');
  });

  it('非枚举形态 → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/platform/settings',
      payload: { target_runtime_form: 'made_up', revision: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('缺 revision → VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/platform/settings',
      payload: { target_runtime_form: 'host_local' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('revision 不符 → ADM_CONFIG_REVISION_CONFLICT（FR-008 并发编辑）', async () => {
    const res = await fx.app.inject({
      method: 'PUT',
      url: '/api/admin/platform/settings',
      payload: { target_runtime_form: 'host_local', revision: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('ADM_CONFIG_REVISION_CONFLICT');
    // 冲突时不得写入
    const after = (await fx.app.inject({ method: 'GET', url: '/api/admin/platform/settings' })).json();
    expect(after.target_runtime_form).toBe('container_network');
  });
});

describe('未知路径', () => {
  it('统一错误 envelope + NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
