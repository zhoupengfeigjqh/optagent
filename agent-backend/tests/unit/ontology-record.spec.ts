/**
 * 单元测试：留档铸造（016）。
 *
 * 重点守 FR-053：单轮明细超限时截断明细，但**保留结论与计数**（selection 计数不变）。
 */
import { describe, expect, it } from 'vitest';
import { MAX_RECORD_DETAILS, buildRecordDraft } from '../../src/domain/ontology-focus/record.js';
import type { CapabilityDecision, CapabilitySelection, SkillDecision } from '../../src/domain/ontology-focus/types.js';

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

function behavior(index: number, source: CapabilityDecision['source'] = 'direct'): CapabilityDecision {
  return {
    kind: 'behavior',
    name: `B${index}`,
    title: `行为${index}`,
    ontologyId: '1',
    ontologyName: '本体',
    score: source === 'direct' ? 0.9 : null,
    selected: true,
    source,
    index,
  };
}

function selection(overrides: Partial<CapabilitySelection> = {}): CapabilitySelection {
  return { behaviors: [behavior(0)], functions: [], supplements: [], truncated: false, ...overrides };
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
  it('映射技能 / 能力 / 补充明细', () => {
    const draft = buildRecordDraft({
      ...BASE,
      skills: [skill(true), skill(false)],
      capabilities: {
        ...selection(),
        supplements: [{ ontologyId: '1', behavior: 'B0', supplement: 'Q1', found: false }],
      },
    });

    expect(draft.skills.map((item) => item.selected)).toEqual([true, false]);
    expect(draft.behaviors.map((item) => item.name)).toEqual(['B0']);
    expect(draft.behaviors[0]).not.toHaveProperty('ontology_ids');
    expect(draft.data_supplements).toEqual([
      { ontology_id: '1', behavior: 'B0', supplement: 'Q1', found: false },
    ]);
  });

  it('能力明细超过 200 条时截断并置 truncated', () => {
    const behaviors = Array.from({ length: 260 }, (_, i) => behavior(i));
    const draft = buildRecordDraft({
      ...BASE,
      skills: [skill(true)],
      capabilities: selection({ behaviors }),
    });

    expect(draft.behaviors).toHaveLength(MAX_RECORD_DETAILS);
    expect(draft.truncated).toBe(true);
  });

  it('补充明细同样受上限约束', () => {
    const supplements = Array.from({ length: 260 }, (_, i) => ({
      ontologyId: '1',
      behavior: 'B0',
      supplement: `Q${i}`,
      found: true,
    }));
    const draft = buildRecordDraft({
      ...BASE,
      skills: [skill(true)],
      capabilities: selection({ supplements }),
    });
    expect(draft.data_supplements).toHaveLength(MAX_RECORD_DETAILS);
    expect(draft.truncated).toBe(true);
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
