/**
 * 单元测试：`task_planning` 开关的校验与物化（028 T701s，FR-001）。
 *
 * 与 `soul-design-rewrite-switch.spec.ts` 同构，覆盖：
 * - **缺省**：键缺失 / 新建 / 存量升级一律 `false`；
 * - **校验**：非布尔一律拒绝（不静默转 false）；
 * - **物化**：只有「意图聚焦 且 任务规划」都为真才写键；
 * - **保留**：聚焦关闭时值保留（管理台置灰），产物零残留。
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/domain/api-error.js';
import {
  emptySoulDesign,
  fromLegacySoul,
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

function frontmatterOf(md: string): string[] {
  const end = md.indexOf('\n---', 3);
  return md.slice(4, end).split('\n');
}

describe('028 任务规划开关 —— 缺省与校验', () => {
  it('缺省：键缺失 / 新建 / 存量升级一律 false', () => {
    expect(normalizeSoulDesign(validRaw(), OPTIONS).task_planning).toBe(false);
    expect(emptySoulDesign().task_planning).toBe(false);
    expect(fromLegacySoul('你是助手').task_planning).toBe(false);
  });

  it('读写往返：显式 true / false 原样保留', () => {
    expect(normalizeSoulDesign({ ...validRaw(), task_planning: true }, OPTIONS).task_planning).toBe(true);
    expect(normalizeSoulDesign({ ...validRaw(), task_planning: false }, OPTIONS).task_planning).toBe(false);
  });

  it('非布尔一律拒绝式失败', () => {
    for (const value of ['true', 1, 0, null, {}, []]) {
      let caught: unknown;
      try {
        normalizeSoulDesign({ ...validRaw(), task_planning: value }, OPTIONS);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });
});

describe('028 任务规划开关 —— 物化', () => {
  it('聚焦 + 开关都为真才写键（字面量 true）', () => {
    const md = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, task_planning: true }, OPTIONS),
    );
    expect(frontmatterOf(md)).toEqual(
      expect.arrayContaining(['intent_focus: true', 'task_planning: true']),
    );
  });

  it('只开意图聚焦不写本键（未勾选即零规划调用）', () => {
    const md = renderSoulMd(normalizeSoulDesign({ ...validRaw(), intent_focus: true }, OPTIONS));
    expect(md).not.toContain('task_planning');
  });

  it('意图聚焦关闭：值保留，产物与完全缺省态逐字一致', () => {
    const soul = normalizeSoulDesign(
      { ...validRaw(), intent_focus: false, task_planning: true },
      OPTIONS,
    );
    expect(soul.task_planning).toBe(true);
    const md = renderSoulMd(soul);
    expect(md).not.toContain('task_planning');
    expect(md).toBe(renderSoulMd(normalizeSoulDesign(validRaw(), OPTIONS)));
  });

  it('开关打开只多一行 frontmatter，正文逐字一致', () => {
    const on = renderSoulMd(
      normalizeSoulDesign({ ...validRaw(), intent_focus: true, task_planning: true }, OPTIONS),
    );
    const off = renderSoulMd(normalizeSoulDesign({ ...validRaw(), intent_focus: true }, OPTIONS));
    const body = (md: string) => md.slice(md.indexOf('\n---', 3) + 4);

    expect(body(on)).toBe(body(off));
    expect(on.split('\n').length - off.split('\n').length).toBe(1);
  });

  it('存量 / 新建数字人物化后不含本键', () => {
    expect(renderSoulMd(fromLegacySoul('你是助手'))).not.toContain('task_planning');
    expect(renderSoulMd(emptySoulDesign())).not.toContain('task_planning');
  });
});
