/**
 * 单元测试：MCP 工具入参 schema 的根标题视图（方案 A，2026-10-30）。
 *
 * 守住四条：
 * 1. 有服务端 `Tool.title`：删 SDK 生成的类名 `title`，写 `x-title`（trim 后）；
 * 2. 无服务端标题：**原样透传**（不把类名改名成 `x-title`，那是伪造"人读标题"）；
 * 3. 字段级 `title` 不动（运行环境 HITL 表单的字段标签靠它）；
 * 4. 幂等 + 不改入参对象。
 *
 * 与运行环境 `agent-backend/.../mcp-schema-view.spec.ts` 的 `withServerTitleX`
 * 用例一一对应：两侧独立部署、无共享包，口径必须逐字一致。
 */
import { describe, expect, it } from 'vitest';
import { withServerTitleX } from '../../src/domain/mcp/tool-schema-title.js';

function schema() {
  return {
    title: 'ocr_imageArguments',
    type: 'object',
    properties: { image: { type: 'string', title: '待识别图片' } },
    required: ['image'],
  };
}

describe('withServerTitleX', () => {
  it('有服务端标题 → 根 title 改名 x-title，其余键原样', () => {
    const out = withServerTitleX(schema(), ' 图片识别 ') as Record<string, unknown>;

    expect(out).not.toHaveProperty('title');
    expect(out['x-title']).toBe('图片识别');
    expect(out.type).toBe('object');
    expect(out.required).toEqual(['image']);
    expect((out.properties as Record<string, { title?: string }>).image?.title).toBe('待识别图片');
  });

  it('无服务端标题（缺省 / 空白）→ 原样返回同一个对象', () => {
    const source = schema();

    expect(withServerTitleX(source)).toBe(source);
    expect(withServerTitleX(source, '   ')).toBe(source);
    expect(source.title).toBe('ocr_imageArguments');
  });

  it('不改入参对象（只浅拷贝根）', () => {
    const source = schema();

    withServerTitleX(source, '图片识别');

    expect(source.title).toBe('ocr_imageArguments');
    expect(source).not.toHaveProperty('x-title');
  });

  it('幂等：重复应用结果一致', () => {
    const once = withServerTitleX(schema(), '图片识别');

    expect(withServerTitleX(once, '图片识别')).toEqual(once);
  });

  it('非对象 schema 原样返回', () => {
    expect(withServerTitleX('not-a-schema', '图片识别')).toBe('not-a-schema');
    expect(withServerTitleX(null, '图片识别')).toBeNull();
  });
});
