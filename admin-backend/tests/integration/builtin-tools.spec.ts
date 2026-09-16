/**
 * 集成测试：内置工具目录投影（T048，契约 §2.1）
 *
 * 覆盖正常投影、字段裁剪、有界返回与运行环境不可达（`ADM_RUNTIME_UNREACHABLE`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, type TestFixture } from '../helpers/fixture.js';

let fx: TestFixture;

beforeEach(async () => {
  fx = await createFixture();
  fx.runtime.tools = [
    {
      name: 'read_file',
      label: '读取文件',
      description_template: '如 "{示例路径}"',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: { path: { type: 'string', description: '相对路径，如 "{示例路径}"' } },
      },
      writable: false,
    },
    {
      name: 'write_file',
      label: '写入临时文件',
      description_template: '文件名自动要求以 "{会话标识}_" 开头',
      parameters: { type: 'object' },
      writable: true,
      // 运行环境内部字段：MUST NOT 泄漏到管理契约
      internalOnly: 'should-be-dropped',
    },
  ];
});

afterEach(async () => {
  await fx.cleanup();
});

describe('GET /api/admin/builtin-tools', () => {
  it('只读投影：原样保留占位符模板（FR-012 / SC-014）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.truncated).toBe(false);
    expect(body.items[0].description_template).toContain('{示例路径}');
    expect(JSON.stringify(body.items[0].parameters)).toContain('{示例路径}');
    expect(JSON.stringify(body)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('字段裁剪：只返回契约声明的五个字段', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools' });
    const item = res.json().items[1];
    expect(Object.keys(item).sort()).toEqual([
      'description_template',
      'label',
      'name',
      'parameters',
      'writable',
    ]);
  });

  it('writable 语义保留', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools' });
    const items = res.json().items as Array<{ name: string; writable: boolean }>;
    expect(items.find((i) => i.name === 'write_file')?.writable).toBe(true);
    expect(items.find((i) => i.name === 'read_file')?.writable).toBe(false);
  });

  it('有界返回：limit 生效并标记 truncated（FR-006）', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools?limit=1' });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(1);
    expect(res.json().total).toBe(2);
    expect(res.json().truncated).toBe(true);
  });

  it('limit 非法 → 400 VALIDATION_FAILED', async () => {
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools?limit=0' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('运行环境不可达 → 503 ADM_RUNTIME_UNREACHABLE（不静默返回空清单）', async () => {
    fx.runtime.unreachable = true;
    const res = await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('ADM_RUNTIME_UNREACHABLE');
  });
});

describe('内置工具目录不被平台持久化', () => {
  it('平台设计态不出现 builtin-tools.json（data-model.md §2）', async () => {
    await fx.app.inject({ method: 'GET', url: '/api/admin/builtin-tools' });
    expect(fx.ctx.store.exists('builtin-tools.json')).toBe(false);
  });
});
