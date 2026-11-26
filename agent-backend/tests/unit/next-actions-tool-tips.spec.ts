/**
 * 单元测试：`tool_tips` 归一化（2026-11-26，S1 加固）。
 *
 * 请求体里的 `tool_tips` 此前是"原文直通渲染"：条数、元素形状都不设边界，
 * 客户端可以把 systemExtra 撑大或塞进非对象条目。这里钉住公共读取器的三条口径：
 * 非数组 → 空；超上限 → 截断；字段缺失/类型不对 → 留空值但条目保留。
 */
import { describe, expect, it } from 'vitest';

import { MAX_TOOL_TIPS_PER_ACTION, normalizeToolTips } from '../../src/domain/next-actions.js';

describe('normalizeToolTips', () => {
  it('非数组 → 空数组（不抛错）', () => {
    expect(normalizeToolTips(undefined)).toEqual([]);
    expect(normalizeToolTips('not-an-array')).toEqual([]);
    expect(normalizeToolTips({ name: 'x' })).toEqual([]);
  });

  it('超出上限 → 截断到 MAX_TOOL_TIPS_PER_ACTION', () => {
    const raw = Array.from({ length: MAX_TOOL_TIPS_PER_ACTION + 3 }, (_, i) => ({
      name: `t${i}`,
      title: `动作 ${i}`,
    }));

    const tips = normalizeToolTips(raw);
    expect(tips).toHaveLength(MAX_TOOL_TIPS_PER_ACTION);
    expect(tips[0]!.name).toBe('t0');
  });

  it('元素缺字段 / 类型不对 → 留空值，条目不丢', () => {
    expect(normalizeToolTips([{}, null, 42, { name: 7, ontology_name: 9 }])).toEqual([
      { name: '', title: '', ontology_id: '', ontology_name: null },
      { name: '', title: '', ontology_id: '', ontology_name: null },
      { name: '', title: '', ontology_id: '', ontology_name: null },
      { name: '', title: '', ontology_id: '', ontology_name: null },
    ]);
  });

  it('合法条目原样保留', () => {
    expect(
      normalizeToolTips([
        { name: 'QueryInventory', title: '查询库存', ontology_id: 'beh-1', ontology_name: '库存' },
      ]),
    ).toEqual([
      { name: 'QueryInventory', title: '查询库存', ontology_id: 'beh-1', ontology_name: '库存' },
    ]);
  });
});
