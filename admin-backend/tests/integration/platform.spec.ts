/**
 * 集成测试：平台级端点（契约 §1.1）
 *
 * **2026-09-27**：§1.2~§1.4（平台设置与运行形态）随「MCP 服务全人工配置」下架，
 * 本文件只保留健康检查与未知路径两条。MUST 覆盖正常路径与错误码（宪章原则三）。
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
  it('一次性给出外部依赖的可达性（平台设计态 + 运行环境用户数据根）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.platform_data).toEqual({ writable: true, path: fx.platformDataDir });
    expect(body.opt_agent.readable).toBe(true);
    expect(body.opt_agent.writable).toBe(true);
    expect(body.opt_agent.path).toBe(fx.optAgentRoot);
    // 容器编排 / Docker / 运行形态三个字段已随概念下架，MUST NOT 再出现在响应里
    expect(body.compose_file).toBeUndefined();
    expect(body.docker).toBeUndefined();
    expect(body.runtime_form).toBeUndefined();
  });
});

describe('已下架的运行形态端点', () => {
  it('GET /api/admin/platform/settings → 404（平台不再持有目标运行形态）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/settings' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/admin/platform/runtime-forms → 404', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/platform/runtime-forms' });
    expect(res.statusCode).toBe(404);
  });
});

describe('未知路径', () => {
  it('统一错误 envelope + NOT_FOUND', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
