/**
 * 单元测试：聚焦阶数 `intent_focus_depth` 的校验与物化（019）。
 *
 * 从 `soul-design.spec.ts` 拆出：019 的增量用例使原文件超过 500 行（原则二），
 * 这里只保留阶数相关的**校验口径**与**产物口径**，主题单一、与被测模块同名同目录。
 *
 * 覆盖三类：
 * - **缺省**：键缺失 / 新建数字人 / 存量升级一律 `0`（等价于 016 行为）；
 * - **校验**：`0~2` 原样通过，越界与非整数拒绝式失败（不 clamp）；
 * - **物化**：仅「开启且非 0」写键；0 阶与关闭态产物逐字一致。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  SOUL_LIMITS,
  emptySoulDesign,
  fromLegacySoul,
  isSoulDesign,
  normalizeSoulDesign,
  renderSoulMd,
} from '../../src/domain/config-center/soul-design.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';

const OPTIONS = {
  enabledTools: ['read_file', 'grep_files'],
  mcpTools: new Map<string, ReadonlySet<string>>([
    ['erp', new Set(['query_order'])],
    ['ocr', new Set(['ocr_extract'])],
  ]),
};

function validRaw(): Record<string, unknown> {
  return {
    intro: '订单交付助理',
    welcome: '你好，我是交付助理',
    starters: [
      {
        prompt: '帮我梳理昨天订单的交付风险',
        tools: [
          { kind: 'builtin', name: 'read_file' },
          { kind: 'mcp', service: 'erp', name: 'query_order' },
        ],
      },
      { prompt: '这个月哪些订单可能延期？', tools: [] },
    ],
    mission: '你是交付助理。',
    capability_tags: ['订单排程'],
    forbidden: ['不得编造订单号'],
    prompt_extra: '回答先给结论。',
  };
}

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(ApiError);
  expect((caught as ApiError).code).toBe(code);
}

describe('intent_focus_depth —— 聚焦阶数（019）', () => {
  it('缺省口径：键缺失 → 0；新建 / 存量升级同样落 0', () => {
    expect(normalizeSoulDesign(validRaw(), OPTIONS).intent_focus_depth).toBe(SOUL_LIMITS.focusDepthDefault);
    expect(emptySoulDesign().intent_focus_depth).toBe(SOUL_LIMITS.focusDepthDefault);
    expect(fromLegacySoul('你是助手').intent_focus_depth).toBe(SOUL_LIMITS.focusDepthDefault);
    expect(renderSoulMd(fromLegacySoul('你是助手'))).not.toContain('intent_focus_depth');
  });

  it('0 / 1 / 2 原样通过（拒绝式，不做隐式换算）', () => {
    for (const value of [SOUL_LIMITS.focusDepthMin, 1, SOUL_LIMITS.focusDepthMax]) {
      expect(
        normalizeSoulDesign({ ...validRaw(), intent_focus: true, intent_focus_depth: value }, OPTIONS)
          .intent_focus_depth,
      ).toBe(value);
    }
  });

  it('越界 / 负数 / 小数 / 字符串 / null / 布尔 → VALIDATION_FAILED', () => {
    for (const value of [-1, SOUL_LIMITS.focusDepthMax + 1, 1.5, '1', null, {}, true]) {
      expectCode(
        () =>
          normalizeSoulDesign({ ...validRaw(), intent_focus: true, intent_focus_depth: value }, OPTIONS),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('渲染：仅「开启且非 0」写键；0 阶与缺省产物逐字一致', () => {
    const on = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, intent_focus_depth: 2 }, OPTIONS),
    );
    expect(on).toContain('intent_focus: true');
    expect(on).toContain('intent_focus_depth: 2');

    const zero = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, intent_focus_depth: 0 }, OPTIONS),
    );
    expect(zero).not.toContain('intent_focus_depth');
    const missing = renderSoulMd(normalizeSoulDesign({ ...validRaw(), intent_focus: true }, OPTIONS));
    expect(zero).toBe(missing);
  });

  it('关闭意图聚焦时不写键（数值保留，再次打开即恢复）', () => {
    const soul = normalizeSoulDesign(
      { ...validRaw(), intent_focus: false, intent_focus_depth: 2 },
      OPTIONS,
    );
    expect(soul.intent_focus_depth).toBe(2);
    const md = renderSoulMd(soul);
    expect(md).not.toContain('intent_focus');
    expect(md).not.toContain('intent_focus_depth');
    // 与完全缺省态的产物一致（未搭配的内容不残留）
    expect(md).toBe(renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS)));
  });

  it('开 / 关两态只差 frontmatter 那两行（开关 + 阶数），正文逐字一致', () => {
    const on = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, intent_focus_depth: 1 }, OPTIONS),
    );
    const off = renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS));
    const body = (md: string) => md.slice(md.indexOf('---', 3) + 3);
    expect(body(on)).toBe(body(off));
    expect(on.split('\n').length - off.split('\n').length).toBe(2);
  });

  it('isSoulDesign：阶数键在 / 不在都不影响「已结构化」判定', () => {
    expect(isSoulDesign({ mission: '你是助手', intent_focus_depth: 2 })).toBe(true);
    expect(isSoulDesign({ mission: '你是助手' })).toBe(true);
  });
});
