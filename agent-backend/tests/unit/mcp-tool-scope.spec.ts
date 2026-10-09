/**
 * 单元测试：MCP 工具白名单过滤（2026-10-03）
 *
 * 守住三条（这是"Agent 只能看到所选工具"真正生效的地方）：
 * 1. 白名单非空 → 只保留命中的工具；
 * 2. **缺省 / 空数组 = 不限制**（存量 `MCP.json` 与平台"非空才写"的物化口径）；
 * 3. 白名单里当前服务不存在的名字（下架/改名）静默跳过，不报错。
 */
import { describe, expect, it } from 'vitest';
import { scopeToolsByAllowlist } from '../../src/infra/mcp-tool-scope.js';

const TOOLS = [
  { name: 'ocr_image', description: '识别图片' },
  { name: 'ocr_pdf', description: '识别 PDF' },
  { name: 'query_price', description: '查价' },
];

describe('scopeToolsByAllowlist', () => {
  it('白名单非空 → 只保留命中的工具（其余对模型不可见）；顺序沿用服务返回的顺序', () => {
    expect(scopeToolsByAllowlist(TOOLS, ['query_price', 'ocr_image']).map((t) => t.name)).toEqual([
      'ocr_image',
      'query_price',
    ]);
  });

  it('缺省 / 空数组 = 不限制：原表返回（存量 MCP.json 行为不变）', () => {
    expect(scopeToolsByAllowlist(TOOLS, undefined)).toHaveLength(3);
    expect(scopeToolsByAllowlist(TOOLS, [])).toHaveLength(3);
  });

  it('白名单里已不存在的工具名（下架/改名）→ 静默跳过，不报错', () => {
    const scoped = scopeToolsByAllowlist(TOOLS, ['ocr_image', 'gone_tool']);
    expect(scoped.map((t) => t.name)).toEqual(['ocr_image']);
  });

  it('白名单全都不存在 → 该服务一个工具也不挂（不是"放行全部"）', () => {
    expect(scopeToolsByAllowlist(TOOLS, ['gone_a', 'gone_b'])).toEqual([]);
  });
});
