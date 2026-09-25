/**
 * 单元测试：MCP 工具入参 schema 的视图裁剪（`mcp-schema-view.ts`）
 *
 * 两条规则各自的边界：
 * 1. `exposeSchema`：删除由运行环境注入的参数（含 `required` 同名项）；
 *    未声明注入时**原样返回**（不碰第三方给的 schema 对象）；
 * 2. `hideSchemaPaths`：按取值路径剔除 `file_args` 派生目标字段——对象段 / 数组段 /
 *    多级；schema 里没有该字段时跳过（运行期注入照旧）；空路径原样返回。
 *
 * 这些分支此前散落在 `mcp-tool-adapter.ts`（既有超限文件）中、未被直接覆盖；
 * 搬运成独立模块后在本文件补齐（抽出即新模块，新模块 MUST 达标）。
 */
import { describe, expect, it } from 'vitest';
import { parseFileArgPath } from '../../src/domain/file-arg-path.js';
import { exposeSchema, hideSchemaPaths } from '../../src/infra/mcp/mcp-schema-view.js';

/** 与真实对接方形状同构：顶层标量 + 对象数组 + 标量数组 */
function schema() {
  return {
    type: 'object',
    properties: {
      uid: { type: 'string' },
      plan: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            excelFileUrl: { type: 'string' },
            realRelativePath: { type: 'string' },
          },
          required: ['excelFileUrl'],
        },
      },
      files: { type: 'array', items: { type: 'string' } },
    },
    required: ['uid', 'plan'],
  };
}

describe('exposeSchema —— 按参数名删除', () => {
  it('未声明注入参数：原样返回（同一对象引用）', () => {
    const source = schema();
    expect(exposeSchema(source, [])).toBe(source);
  });

  it('删除注入参数，并同步清理 required 里的同名项', () => {
    const out = exposeSchema(schema(), ['uid']) as {
      properties: Record<string, unknown>;
      required?: string[];
    };
    expect(out.properties).not.toHaveProperty('uid');
    expect(out.properties).toHaveProperty('plan');
    expect(out.required).toEqual(['plan']);
  });

  it('required 被清空时整键删除（不留空数组）', () => {
    const out = exposeSchema(schema(), ['uid', 'plan']) as { required?: string[] };
    expect(out.required).toBeUndefined();
  });

  it('schema 缺失或非对象：给最小空对象（不让上层拿到 undefined）', () => {
    expect(exposeSchema(null, ['uid'])).toEqual({ type: 'object', properties: {} });
    expect(exposeSchema(undefined, ['uid'])).toEqual({ type: 'object', properties: {} });
  });
});

describe('hideSchemaPaths —— 按取值路径剔除派生目标字段', () => {
  it('空路径：原样返回（同一对象引用）', () => {
    const source = schema();
    expect(hideSchemaPaths(source, [])).toBe(source);
  });

  it('数组元素字段（items[].excelFileUrl）：只删该字段并清理其 required', () => {
    const out = hideSchemaPaths(schema(), [parseFileArgPath('items[].excelFileUrl')!]) as {
      properties: {
        items: { items: { properties: Record<string, unknown>; required?: string[] } };
      };
    };
    const item = out.properties.items.items;
    expect(item.properties).not.toHaveProperty('excelFileUrl');
    expect(item.properties).toHaveProperty('realRelativePath');
    expect(item.required).toBeUndefined();
  });

  it('整段数组属性（files[]）：该属性被删除', () => {
    const out = hideSchemaPaths(schema(), [parseFileArgPath('files[]')!]) as {
      properties: Record<string, unknown>;
    };
    expect(out.properties).not.toHaveProperty('files');
  });

  it('schema 里没有该字段：跳过（不报错、其余不变、返回同一对象）', () => {
    const source = schema();
    expect(hideSchemaPaths(source, [parseFileArgPath('items[].notThere')!])).toBe(source);
  });

  it('顶层对象段与数组段可叠加', () => {
    const out = hideSchemaPaths(schema(), [
      parseFileArgPath('uid')!,
      parseFileArgPath('items[].excelFileUrl')!,
    ]) as { properties: Record<string, unknown>; required?: string[] };

    expect(out.properties).not.toHaveProperty('uid');
    expect(out.required).toEqual(['plan']);
  });

  it('非对象节点：原样返回', () => {
    expect(hideSchemaPaths('not-a-schema', [parseFileArgPath('a')!])).toBe('not-a-schema');
  });

  it('多级对象路径（input.url）：逐层下行只改叶子所在分支', () => {
    const nested = {
      type: 'object',
      properties: {
        input: {
          type: 'object',
          properties: { url: { type: 'string' }, keep: { type: 'string' } },
        },
      },
    };
    const out = hideSchemaPaths(nested, [parseFileArgPath('input.url')!]) as {
      properties: { input: { properties: Record<string, unknown> } };
    };

    expect(out.properties.input.properties).not.toHaveProperty('url');
    expect(out.properties.input.properties).toHaveProperty('keep');
  });

  it('数组段的中间层不存在（未声明 items 属性）：跳过，原样返回', () => {
    const source = {
      type: 'object',
      properties: { other: { type: 'array', items: { type: 'object' } } },
    };
    expect(hideSchemaPaths(source, [parseFileArgPath('items[].x')!])).toBe(source);
  });
});

describe('exposeSchema —— 无 required 的 schema', () => {
  it('删除参数不凭空造出 required（原本没有就仍没有）', () => {
    const out = exposeSchema({ type: 'object', properties: { uid: { type: 'string' } } }, [
      'uid',
    ]) as { properties: Record<string, unknown>; required?: string[] };

    expect(out.properties).not.toHaveProperty('uid');
    expect(out.required).toBeUndefined();
  });
});
