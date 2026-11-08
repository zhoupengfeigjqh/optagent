/**
 * 单元测试：行为选择与去重（016）。
 *
 * 核心口径（2026-11-06）：
 * - 严格大于阈值才入选；等于阈值丢弃；
 * - 只返回入选行为（不再有函数、不再有规则补充）；
 * - 类内按 `ontology_id + name` 去重，跨本体同名各自保留；
 * - 分数降序、同分按本体原序；
 * - **选择阶段不做二次截断**：候选上限只由构造阶段的 `max_capabilities` 施加。
 */
import { describe, expect, it } from 'vitest';
import { selectCapabilities, selectSkills } from '../../src/domain/intent-focus/selection.js';
import type {
  CapabilityCandidate,
  OntologyDefinition,
  SkillCandidate,
} from '../../src/domain/intent-focus/types.js';

function ontology(): OntologyDefinition {
  return {
    filePath: '/o/1.yaml',
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    scenarioId: '2',
    scenarioName: '生产调度',
    behaviors: [
      { name: 'B1', title: '创建采购单', description: '', opType: 'command' },
      { name: 'B2', title: '取消采购单', description: '', opType: 'command' },
      { name: 'Q1', title: '查询采购记录', description: '', opType: 'query' },
      { name: 'Q2', title: '查询原材料', description: '', opType: 'query' },
      { name: 'Q3', title: '查询供应商', description: '', opType: 'query' },
    ],
  };
}

const TITLES: Record<string, string> = {
  B1: '创建采购单',
  B2: '取消采购单',
  Q1: '查询采购记录',
  Q2: '查询原材料',
  Q3: '查询供应商',
};

function candidates(names: string[], ontologyId = '1', ontologyName = '原材料采购和库存'): CapabilityCandidate[] {
  return names.map((name, index) => ({
    qid: `c${index + 1}`,
    name,
    title: TITLES[name] ?? name,
    description: '',
    ontologyId,
    ontologyName,
    index,
  }));
}

const ALL = candidates(['B1', 'B2', 'Q1', 'Q2', 'Q3']);

describe('selectCapabilities · 阈值与顺序', () => {
  it('严格大于阈值：等于阈值不入，高于才入', () => {
    const result = selectCapabilities(ALL, { c1: 0.6, c2: 0.61, c3: 0.9, c4: 0, c5: 0 }, 0.6);
    expect(result.behaviors.map((item) => item.name)).toEqual(['Q1', 'B2']);
    expect(result.behaviors[0]!.score).toBe(0.9);
  });

  it('分数降序、同分按原序', () => {
    const result = selectCapabilities(ALL, { c1: 0.7, c2: 0.9, c3: 0.7, c4: 0.7, c5: 0 }, 0.6);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B2', 'B1', 'Q1', 'Q2']);
  });

  it('缺失分数的候选不入选', () => {
    const result = selectCapabilities(ALL, { c1: 0.9 }, 0.6);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
  });

  it('未入选行为不会被任何规则补入（规则链路已删除）', () => {
    const result = selectCapabilities(ALL, { c1: 0.9, c2: 0.1, c3: 0.05, c4: 0.05, c5: 0.05 }, 0.6);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
  });
});

describe('selectCapabilities · 去重', () => {
  it('同一 ontology_id + name 只留一项，保留最高分', () => {
    const list: CapabilityCandidate[] = [
      ...ALL,
      { qid: 'c9', name: 'B1', title: '创建采购单', ontologyId: '1', ontologyName: '原材料采购和库存', index: 9 },
    ];
    const result = selectCapabilities(list, { c1: 0.7, c9: 0.95 }, 0.6);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(result.behaviors[0]!.score).toBe(0.95);
  });

  it('跨本体同名各自保留（去重键含 ontology_id）', () => {
    const other: CapabilityCandidate[] = [
      { qid: 'c6', name: 'B1', title: '创建采购单', ontologyId: '2', ontologyName: '另一个本体', index: 0 },
    ];
    const result = selectCapabilities([...ALL, ...other], { c1: 0.9, c6: 0.95 }, 0.6);
    const b1 = result.behaviors.filter((item) => item.name === 'B1');
    expect(b1).toHaveLength(2);
    expect(b1.map((item) => item.ontologyId)).toEqual(['2', '1']);
  });
});

describe('selectCapabilities · 上限', () => {
  it('选择阶段不二次截断（上限只在候选构造阶段按 max_capabilities 施加）', () => {
    const behaviors = Array.from({ length: 100 }, (_, i) => ({
      name: `X${i}`,
      title: `行为${i}`,
      description: '',
      opType: 'command' as const,
    }));
    const big: OntologyDefinition = { ...ontology(), behaviors: [...ontology().behaviors, ...behaviors] };
    const list = candidates(big.behaviors.map((item) => item.name));
    const scores: Record<string, number> = {};
    for (const candidate of list) scores[candidate.qid] = 0.9;

    const result = selectCapabilities(list, scores, 0.6);
    expect(result.behaviors).toHaveLength(list.length);
    expect(result.behaviors[0]!.name).toBe(list[0]!.name);
  });
});

describe('selectSkills', () => {
  it('严格阈值 + 未入选原因；保留候选原序', () => {
    const skillCandidates: SkillCandidate[] = [
      {
        qid: 's1',
        header: {
          name: 'a',
          description: 'A',
          dirName: 'a',
          metadata: { ontologyId: null, ontologyName: null, scenarioId: null, scenarioName: null },
        },
        matchedOntologies: [],
        isOntologySkill: false,
        index: 0,
      },
      {
        qid: 's2',
        header: {
          name: 'b',
          description: 'B',
          dirName: 'b',
          metadata: { ontologyId: '1', ontologyName: '本体', scenarioId: null, scenarioName: null },
        },
        matchedOntologies: [ontology()],
        isOntologySkill: true,
        index: 1,
      },
    ];
    const decisions = selectSkills(skillCandidates, { s1: 0.6, s2: 0.61 }, 0.6);
    expect(decisions.map((decision) => decision.selected)).toEqual([false, true]);
    expect(decisions[0]!.reason).toBe('below_threshold');
    expect(decisions[0]!.ontologyId).toBeNull();
    expect(decisions[1]!.ontologyId).toBe('1');
  });
});
