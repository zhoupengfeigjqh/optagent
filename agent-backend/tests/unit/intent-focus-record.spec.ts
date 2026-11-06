/**
 * 单元测试：留档铸造（016）。
 *
 * 2026-11-06 口径：只写**入选行为**，不再有 `kind` / `selected` / `source`，
 * 也不再写 `functions` 与 `data_supplements`；明细规模由选择层上限（≤96）天然约束。
 */
import { describe, expect, it } from 'vitest';
import { buildRecordDraft } from '../../src/domain/intent-focus/record.js';
import type { CapabilityDecision, CapabilitySelection, SkillDecision } from '../../src/domain/intent-focus/types.js';

function skill(selected: boolean): SkillDecision {
  return {
    header: {
      name: 'skill',
      description: '技能',
      dirName: 'skill',
      metadata: { ontologyId: '1', ontologyName: '本体', scenarioId: null, scenarioName: null },
    },
    isOntology: true,
    ontologyId: '1',
    score: 0.9,
    selected,
    reason: selected ? null : 'below_threshold',
  };
}

function behavior(index: number): CapabilityDecision {
  return {
    name: `B${index}`,
    title: `行为${index}`,
    ontologyId: '1',
    ontologyName: '本体',
    score: 0.9,
    index,
  };
}

function selection(overrides: Partial<CapabilitySelection> = {}): CapabilitySelection {
  return { behaviors: [behavior(0)], ...overrides };
}

const BASE = {
  threadId: 't1',
  agentName: 'a',
  messageId: 'm1',
  input: '创建采购单',
  inputTruncated: false,
  disposition: 'focused' as const,
  reason: null,
  model: 'laya',
  roundMs: 12,
  candidateCount: 3,
  batches: 1,
  truncated: false,
  prompt: '提示',
  promptTruncated: false,
  warnings: [],
  error: null,
};

describe('buildRecordDraft', () => {
  it('映射技能与入选行为；不再写函数 / 数据补充 / 恒定字段', () => {
    const draft = buildRecordDraft({
      ...BASE,
      skills: [skill(true), skill(false)],
      capabilities: selection({ behaviors: [behavior(0), behavior(1)] }),
    });

    expect(draft.skills.map((item) => item.selected)).toEqual([true, false]);
    expect(draft.behaviors.map((item) => item.name)).toEqual(['B0', 'B1']);
    expect(draft.behaviors[0]).toEqual({
      name: 'B0',
      title: '行为0',
      ontology_id: '1',
      ontology_name: '本体',
      score: 0.9,
    });
    expect(draft).not.toHaveProperty('functions');
    expect(draft).not.toHaveProperty('data_supplements');
  });

  it('行为明细原样透传，不做二次裁剪', () => {
    const behaviors = Array.from({ length: 96 }, (_, i) => behavior(i));
    const draft = buildRecordDraft({
      ...BASE,
      skills: [skill(true)],
      capabilities: selection({ behaviors }),
    });
    expect(draft.behaviors).toHaveLength(96);
  });

  it('输入截断标记与错误原样带出', () => {
    const draft = buildRecordDraft({
      ...BASE,
      inputTruncated: true,
      error: 'timeout',
      skills: [skill(true)],
      capabilities: selection(),
    });
    expect(draft.input_truncated).toBe(true);
    expect(draft.error).toBe('timeout');
  });
});
