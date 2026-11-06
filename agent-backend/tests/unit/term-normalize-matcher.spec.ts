/**
 * 单元测试：术语替换匹配（018，`domain/term-normalize/matcher.ts`）。
 *
 * 守四条最容易走样的口径：
 * ① 最长优先（`供应商编号` 不被拆成 `供应商`）；
 * ② 单遍、不重叠、不递归（`物料→原材料` 后不会再把 `原材料` 换成别的）；
 * ③ 最短长度 2（单字术语不建进树）；
 * ④ 命中即同值不算替换（否则弹窗会为"没变的内容"反复出现）。
 */
import { describe, expect, it } from 'vitest';

import { MIN_TERM_LENGTH, normalizeByTerms } from '../../src/domain/term-normalize/matcher.js';

describe('normalizeByTerms · 匹配口径', () => {
  it('最长优先：命中长术语时不再拆短术语', () => {
    const result = normalizeByTerms('查一下供应商编号', {
      供应商: '供应方',
      供应商编号: '供应方编码',
    });

    expect(result.normalized).toBe('查一下供应方编码');
    expect(result.matches).toEqual([
      { term: '供应商编号', value: '供应方编码', start: 3, end: 8 },
    ]);
  });

  it('单遍不递归：替换结果不会在同一轮被再次替换', () => {
    const result = normalizeByTerms('物料', { 物料: '原材料', 原材料: '钢材' });
    expect(result.normalized).toBe('原材料');
    expect(result.applied).toBe(true);
  });

  it('多处命中按原文顺序返回，且不重叠', () => {
    const result = normalizeByTerms('物料和供应商信息', {
      物料: '原材料',
      供应商信息: '供应商',
    });

    expect(result.normalized).toBe('原材料和供应商');
    expect(result.matches.map((item) => item.term)).toEqual(['物料', '供应商信息']);
  });

  it('没有命中 → applied:false，原文逐字返回', () => {
    const result = normalizeByTerms('今天天气不错', { 物料: '原材料' });
    expect(result).toEqual({ applied: false, normalized: '今天天气不错', matches: [] });
  });

  it('多义值（A或B）原样插入，不在匹配层拆开', () => {
    const result = normalizeByTerms('查供应商信息', { 供应商信息: '供应商或供应商编号' });
    expect(result.normalized).toBe('查供应商或供应商编号');
  });
});

describe('normalizeByTerms · 边界', () => {
  it('最短长度 2：单字术语不参与匹配', () => {
    expect(MIN_TERM_LENGTH).toBe(2);
    const result = normalizeByTerms('看下料', { 料: '原材料' });
    expect(result).toEqual({ applied: false, normalized: '看下料', matches: [] });
  });

  it('命中即同值 → 不算替换（不弹窗）', () => {
    const result = normalizeByTerms('查看供应商', { 供应商: '供应商' });
    expect(result.applied).toBe(false);
    expect(result.normalized).toBe('查看供应商');
  });

  it('空表 → 原文返回', () => {
    expect(normalizeByTerms('随便一句话', {})).toEqual({
      applied: false,
      normalized: '随便一句话',
      matches: [],
    });
  });

  it('下标是 UTF-16 偏移（含 emoji 也不偏）', () => {
    const result = normalizeByTerms('😀物料', { 物料: '原材料' });
    // `😀` 占两个 UTF-16 单元，前端可直接用 slice 高亮
    expect(result.matches[0]).toMatchObject({ start: 2, end: 4 });
    expect(result.normalized.slice(0, 2)).toBe('😀');
  });
});
