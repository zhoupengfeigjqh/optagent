/**
 * 单元测试：意图聚焦公共口径（016）。
 *
 * 只守两件事：输入截断（取尾部、尽量对齐句首）、五态处置。
 * 阈值区间校验由 `config.spec.ts` 覆盖；候选 / 选择 / 提示各有独立测试，不在这里重复。
 */
import { describe, expect, it } from 'vitest';
import { MAX_STATE_CHARS, decideDisposition, prepareState } from '../../src/domain/intent-focus/state.js';

describe('prepareState', () => {
  it('短输入原样返回且不标记截断', () => {
    expect(prepareState('创建采购单')).toEqual({ state: '创建采购单', truncated: false });
  });

  it('超长输入取尾部（问题通常在后半段）', () => {
    const input = `${'材料'.repeat(300)}创建采购单`;
    const result = prepareState(input);
    expect(result.truncated).toBe(true);
    expect(result.state.endsWith('创建采购单')).toBe(true);
    expect(result.state.length).toBeLessThanOrEqual(MAX_STATE_CHARS);
  });

  it('截断点尽量对齐到句首（切掉的部分足够长才切）', () => {
    const input = `前言。${'甲'.repeat(300)}。真正的需求是创建一笔原材料采购单并核对供应商资质`;
    expect(prepareState(input).state.startsWith('真正的需求是创建')).toBe(true);
  });

  it('边界值不截断', () => {
    expect(prepareState('甲'.repeat(MAX_STATE_CHARS)).truncated).toBe(false);
    expect(prepareState('甲'.repeat(MAX_STATE_CHARS + 1)).truncated).toBe(true);
  });
});

describe('decideDisposition', () => {
  it('关闭不产生结论（类型层面也不允许）', () => {
    expect(decideDisposition({ kind: 'disabled' })).toBeNull();
  });

  it('跳过 / 未配置 / 失败 各自成态', () => {
    expect(decideDisposition({ kind: 'skipped', reason: 'skip:preset_action' })).toEqual({
      disposition: 'skipped',
      reason: 'skip:preset_action',
    });
    expect(decideDisposition({ kind: 'unconfigured', reason: 'no_config' })).toEqual({
      disposition: 'unconfigured',
      reason: 'no_config',
    });
    expect(decideDisposition({ kind: 'failed', reason: 'timeout' })).toEqual({
      disposition: 'degraded',
      reason: 'timeout',
    });
  });

  it('空结果的三个可区分原因', () => {
    expect(decideDisposition({ kind: 'ok', skillCount: 0, focusableCount: 0, selectedCount: 0 })).toEqual({
      disposition: 'empty',
      reason: 'no_skills',
    });
    expect(decideDisposition({ kind: 'ok', skillCount: 2, focusableCount: 0, selectedCount: 0 })).toEqual({
      disposition: 'empty',
      reason: 'no_focusable_skills',
    });
    expect(decideDisposition({ kind: 'ok', skillCount: 2, focusableCount: 2, selectedCount: 0 })).toEqual({
      disposition: 'empty',
      reason: 'below_threshold',
    });
  });

  it('有入选即 focused', () => {
    expect(
      decideDisposition({ kind: 'ok', skillCount: 2, focusableCount: 2, selectedCount: 1 }),
    ).toEqual({ disposition: 'focused', reason: null });
  });
});
