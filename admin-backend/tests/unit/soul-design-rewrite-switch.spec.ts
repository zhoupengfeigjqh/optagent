/**
 * 单元测试：`input_rewrite` / `term_normalize` 两个开关的校验与物化（027）。
 *
 * 与 `soul-design-focus-depth.spec.ts` 同构（019 当初也从主 spec 拆出，理由相同：
 * 主 spec 已 442 行，再加 027 的用例必然破 500 行门禁）。
 *
 * 覆盖：
 * - **缺省**：键缺失 / 新建 / 存量升级一律 `false`，产物不出现这两个键；
 * - **校验**：非布尔一律拒绝（不静默转成 false），数组 / 字符串 / 数字都算脏数据；
 * - **物化**：只有「意图聚焦 且 本开关」都为真才写键（关闭态零残留）；
 * - **保留**：意图聚焦关闭时值保留（管理台置灰、再开即恢复），但产物不写。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  emptySoulDesign,
  fromLegacySoul,
  isSoulDesign,
  normalizeSoulDesign,
  renderSoulMd,
} from '../../src/domain/config-center/soul-design.js';
import { ERROR_CODES } from '../../src/domain/error-codes.js';

const OPTIONS = {
  enabledTools: ['read_file'],
  mcpTools: new Map<string, ReadonlySet<string>>(),
};

function validRaw(): Record<string, unknown> {
  return {
    intro: '订单交付助理',
    welcome: '你好',
    starters: [],
    mission: '你是交付助理。',
    capability_tags: ['订单排程'],
    forbidden: [],
    prompt_extra: '',
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

/** 只取 frontmatter 行，便于断言"写了哪些键" */
function frontmatterOf(md: string): string[] {
  const end = md.indexOf('\n---', 3);
  return md.slice(4, end).split('\n');
}

describe('027 输入重写 / 术语替换开关 —— 缺省与校验', () => {
  it('缺省：键缺失 → false；新建 / 存量升级同样 false', () => {
    expect(normalizeSoulDesign(validRaw(), OPTIONS).input_rewrite).toBe(false);
    expect(normalizeSoulDesign(validRaw(), OPTIONS).term_normalize).toBe(false);
    expect(emptySoulDesign().input_rewrite).toBe(false);
    expect(emptySoulDesign().term_normalize).toBe(false);
    expect(fromLegacySoul('你是助手').input_rewrite).toBe(false);
    expect(fromLegacySoul('你是助手').term_normalize).toBe(false);
  });

  it('显式 false / true 原样保留（读的是"值"，不是"有没有键"）', () => {
    const on = normalizeSoulDesign(
      { ...validRaw(), intent_focus: true, input_rewrite: true, term_normalize: true },
      OPTIONS,
    );
    expect(on.input_rewrite).toBe(true);
    expect(on.term_normalize).toBe(true);

    const off = normalizeSoulDesign(
      { ...validRaw(), intent_focus: true, input_rewrite: false, term_normalize: false },
      OPTIONS,
    );
    expect(off.input_rewrite).toBe(false);
    expect(off.term_normalize).toBe(false);
  });

  it('非布尔一律拒绝式失败（不静默转成 false，免得"存了却没生效"查不出来）', () => {
    for (const value of ['true', 1, 0, null, {}, [], undefined]) {
      if (value === undefined) continue; // 缺键是合法缺省，不是脏数据
      expectCode(
        () => normalizeSoulDesign({ ...validRaw(), input_rewrite: value }, OPTIONS),
        ERROR_CODES.VALIDATION_FAILED,
      );
      expectCode(
        () => normalizeSoulDesign({ ...validRaw(), term_normalize: value }, OPTIONS),
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
  });

  it('isSoulDesign 判定不受这两个键影响（存量兼容口径不变）', () => {
    expect(isSoulDesign({ mission: '你是助手', input_rewrite: true })).toBe(true);
    expect(isSoulDesign({ mission: '你是助手' })).toBe(true);
  });
});

describe('027 输入重写 / 术语替换开关 —— 物化', () => {
  it('聚焦 + 开关都为真才写键，且都写成字面量 true', () => {
    const md = renderSoulMd(
      normalizeSoulDesign(
        { ...validRaw(), intent_focus: true, input_rewrite: true, term_normalize: true },
        OPTIONS,
      ),
    );

    expect(frontmatterOf(md)).toEqual(
      expect.arrayContaining([
        'soul_version: 1',
        'intent_focus: true',
        'input_rewrite: true',
        'term_normalize: true',
      ]),
    );
  });

  it('只开一个就只写一个（互不牵连）', () => {
    const rewriteOnly = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, input_rewrite: true }, OPTIONS),
    );
    expect(rewriteOnly).toContain('input_rewrite: true');
    expect(rewriteOnly).not.toContain('term_normalize');

    const termOnly = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, term_normalize: true }, OPTIONS),
    );
    expect(termOnly).toContain('term_normalize: true');
    expect(termOnly).not.toContain('input_rewrite');
  });

  it('意图聚焦关闭：值保留，但产物与完全缺省态逐字一致（关闭态零残留）', () => {
    const soul = normalizeSoulDesign(
      { ...validRaw(), intent_focus: false, input_rewrite: true, term_normalize: true },
      OPTIONS,
    );
    // 管理台置灰时需要这两个值仍然在（再次开启即恢复，不必重填）
    expect(soul.input_rewrite).toBe(true);
    expect(soul.term_normalize).toBe(true);

    const md = renderSoulMd(soul);
    expect(md).not.toContain('input_rewrite');
    expect(md).not.toContain('term_normalize');
    expect(md).toBe(renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS)));
  });

  it('开关打开只多两行 frontmatter，正文逐字一致', () => {
    const on = renderSoulMd(
      normalizeSoulDesign(
        { ...validRaw(), intent_focus: true, input_rewrite: true, term_normalize: true },
        OPTIONS,
      ),
    );
    const off = renderSoulMd(normalizeSoulDesign({ ...validRaw(), intent_focus: true }, OPTIONS));
    const body = (md: string) => md.slice(md.indexOf('\n---', 3) + 4);

    expect(body(on)).toBe(body(off));
    expect(on.split('\n').length - off.split('\n').length).toBe(2);
  });

  it('键序固定：intent_focus → intent_focus_depth → input_rewrite → term_normalize → hints', () => {
    const md = renderSoulMd(
      normalizeSoulDesign(
        {
          ...validRaw(),
          intent_focus: true,
          intent_focus_depth: 1,
          input_rewrite: true,
          term_normalize: true,
          next_action_hints: true,
          next_action_hints_count: 2,
        },
        OPTIONS,
      ),
    );
    const keys = frontmatterOf(md).map((line) => line.split(':')[0]!);
    const at = (key: string) => keys.indexOf(key);

    // 只断言这五个开关键的**相对顺序**（introduction / welcome 等展示键另在他处）
    expect(at('intent_focus')).toBeGreaterThanOrEqual(0);
    expect(at('intent_focus')).toBeLessThan(at('intent_focus_depth'));
    expect(at('intent_focus_depth')).toBeLessThan(at('input_rewrite'));
    expect(at('input_rewrite')).toBeLessThan(at('term_normalize'));
    expect(at('term_normalize')).toBeLessThan(at('next_action_hints'));
    expect(at('next_action_hints')).toBeLessThan(at('next_action_hints_count'));
  });

  it('存量自由文本 / 新建数字人物化后不含这两个键（升级不改变既有行为）', () => {
    expect(renderSoulMd(fromLegacySoul('你是助手'))).not.toContain('input_rewrite');
    expect(renderSoulMd(fromLegacySoul('你是助手'))).not.toContain('term_normalize');
    expect(renderSoulMd(emptySoulDesign())).not.toContain('input_rewrite');
    expect(renderSoulMd(emptySoulDesign())).not.toContain('term_normalize');
  });
});
