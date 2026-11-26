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
      { name: 'B1', title: '创建采购单', description: '', opType: 'command', concept: 'PurchaseRecord' },
      { name: 'B2', title: '取消采购单', description: '', opType: 'command', concept: 'PurchaseRecord' },
      { name: 'Q1', title: '查询采购记录', description: '', opType: 'query', concept: 'PurchaseRecord' },
      { name: 'Q2', title: '查询原材料', description: '', opType: 'query', concept: 'RawMaterial' },
      { name: 'Q3', title: '查询供应商', description: '', opType: 'query', concept: 'Supplier' },
    ],
    functions: [
      { name: 'F1', title: '未到位数', description: '', relatedConcepts: ['PurchaseRecord'] },
      { name: 'F2', title: '库存天数', description: '', relatedConcepts: [] },
    ],
    concepts: [],
    relations: [],
  };
}

const TITLES: Record<string, string> = {
  B1: '创建采购单',
  B2: '取消采购单',
  Q1: '查询采购记录',
  Q2: '查询原材料',
  Q3: '查询供应商',
};

function candidates(
  names: string[],
  ontologyId = '1',
  ontologyName = '原材料采购和库存',
): CapabilityCandidate[] {
  return names.map((name, index) => ({
    qid: `c${index + 1}`,
    kind: name.startsWith('F') ? 'function' : 'behavior',
    name,
    title: TITLES[name] ?? name,
    description: '',
    ontologyId,
    ontologyName,
    concept: name.startsWith('F') ? null : 'PurchaseRecord',
    relatedConcepts: name.startsWith('F') ? ['PurchaseRecord'] : [],
    index,
  }));
}

const ALL = candidates(['B1', 'B2', 'Q1', 'Q2', 'Q3']);

const T = { behavior: 0.6, function: 0.6 } as const;

describe('selectCapabilities · 阈值与顺序', () => {
  it('严格大于阈值：等于阈值不入，高于才入', () => {
    const result = selectCapabilities(ALL, { c1: 0.6, c2: 0.61, c3: 0.9, c4: 0, c5: 0 }, T);
    expect(result.behaviors.map((item) => item.name)).toEqual(['Q1', 'B2']);
    expect(result.behaviors[0]!.score).toBe(0.9);
  });

  it('分数降序、同分按原序', () => {
    const result = selectCapabilities(ALL, { c1: 0.7, c2: 0.9, c3: 0.7, c4: 0.7, c5: 0 }, T);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B2', 'B1', 'Q1', 'Q2']);
  });

  it('缺失分数的候选不入选', () => {
    const result = selectCapabilities(ALL, { c1: 0.9 }, T);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
  });

  it('未入选行为不会被任何规则补入（规则链路已删除）', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.1, c3: 0.05, c4: 0.05, c5: 0.05 },
      T,
    );
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
  });
});

describe('selectCapabilities · 去重', () => {
  it('同一 ontology_id + name 只留一项，保留最高分', () => {
    const list: CapabilityCandidate[] = [
      ...ALL,
      {
        qid: 'c9',
        kind: 'behavior',
        name: 'B1',
        title: '创建采购单',
        description: '',
        ontologyId: '1',
        ontologyName: '原材料采购和库存',
        concept: null,
        relatedConcepts: [],
        index: 9,
      },
    ];
    const result = selectCapabilities(list, { c1: 0.7, c9: 0.95 }, T);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(result.behaviors[0]!.score).toBe(0.95);
  });

  it('跨本体同名各自保留（去重键含 ontology_id）', () => {
    const other: CapabilityCandidate[] = [
      {
        qid: 'c6',
        kind: 'behavior',
        name: 'B1',
        title: '创建采购单',
        description: '',
        ontologyId: '2',
        ontologyName: '另一个本体',
        concept: null,
        relatedConcepts: [],
        index: 0,
      },
    ];
    const result = selectCapabilities([...ALL, ...other], { c1: 0.9, c6: 0.95 }, T);
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

    const result = selectCapabilities(list, scores, T);
    expect(result.behaviors).toHaveLength(list.length);
    expect(result.behaviors[0]!.name).toBe(list[0]!.name);
  });
});

describe('selectCapabilities · 行为与函数各自阈值（2026-11-20）', () => {
  const MIXED = candidates(['B1', 'F1', 'F2']);

  it('两类结果分开保存，互不串味', () => {
    const result = selectCapabilities(MIXED, { c1: 0.9, c2: 0.9, c3: 0.9 }, T);

    expect(result.behaviors.map((item) => item.name)).toEqual(['B1']);
    expect(result.functions.map((item) => item.name)).toEqual(['F1', 'F2']);
    expect(result.conceptQueries).toEqual([]);
  });

  it('同一分数可一侧入选、另一侧落选（阈值独立）', () => {
    const result = selectCapabilities(MIXED, { c1: 0.75, c2: 0.75, c3: 0.75 }, {
      behavior: 0.8,
      function: 0.7,
    });

    expect(result.behaviors).toEqual([]);
    expect(result.functions.map((item) => item.name)).toEqual(['F1', 'F2']);
  });

  it('函数用严格大于：等于函数阈值即丢弃', () => {
    const result = selectCapabilities(MIXED, { c2: 0.7 }, { behavior: 0.6, function: 0.7 });

    expect(result.functions).toEqual([]);
  });

  it('函数结果保留 related_concepts（取数入口），行为结果不带该字段', () => {
    const result = selectCapabilities(MIXED, { c1: 0.9, c2: 0.9 }, T);

    expect(result.functions[0]!.relatedConcepts).toEqual(['PurchaseRecord']);
    expect(result.behaviors[0]).not.toHaveProperty('relatedConcepts');
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
