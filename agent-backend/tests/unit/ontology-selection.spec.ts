/**
 * 单元测试：能力选择、数据补充与去重（016）。
 *
 * 核心场景（对应 spec 用户故事 3）：
 * - B1 入选、B2 未入选 → 只补 B1 的 R1，B2 的 R2 不触发；
 * - R1 声明 Q1/Q2，全部补入；多规则重复声明 Q1 只留一次（来源合并）；
 * - 补充项 Q1 自身被 R4 引用时不级联（Q3 不出现）；
 * - 悬空的补充行为名丢弃但留 `found=false`；
 * - 严格大于阈值；行为 / 函数不混；去重后行为类 ≤96。
 */
import { describe, expect, it } from 'vitest';
import { MAX_BEHAVIORS, selectCapabilities, selectSkills } from '../../src/domain/ontology-focus/selection.js';
import type {
  CapabilityCandidate,
  OntologyDefinition,
  SkillCandidate,
} from '../../src/domain/ontology-focus/types.js';

function ontology(): OntologyDefinition {
  return {
    filePath: '/o/1.yaml',
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    scenarioId: '2',
    scenarioName: '生产调度',
    functions: [{ name: 'F1', title: '校验函数' }],
    behaviors: [
      { name: 'B1', title: '创建采购单', opType: 'command' },
      { name: 'B2', title: '取消采购单', opType: 'command' },
      { name: 'Q1', title: '查询采购记录', opType: 'query' },
      { name: 'Q2', title: '查询原材料', opType: 'query' },
      { name: 'Q3', title: '查询供应商', opType: 'query' },
    ],
    rules: [
      { behavior: 'B1', dataSupplements: ['Q1', 'Q2'] },
      { behavior: 'B2', dataSupplements: ['Q3'] },
      { behavior: 'B1', dataSupplements: ['Q1'] },
      { behavior: 'Q1', dataSupplements: ['Q3'] },
      { behavior: 'B1', dataSupplements: ['MissingBehavior'] },
    ],
  };
}

function candidates(names: Array<[CapabilityCandidate['kind'], string]>): CapabilityCandidate[] {
  const titles: Record<string, string> = {
    B1: '创建采购单',
    B2: '取消采购单',
    Q1: '查询采购记录',
    Q2: '查询原材料',
    Q3: '查询供应商',
    F1: '校验函数',
  };
  return names.map(([kind, name], index) => ({
    qid: `c${index + 1}`,
    kind,
    name,
    title: titles[name] ?? name,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    index,
  }));
}

const ALL = candidates([
  ['behavior', 'B1'],
  ['behavior', 'B2'],
  ['behavior', 'Q1'],
  ['behavior', 'Q2'],
  ['behavior', 'Q3'],
  ['function', 'F1'],
]);

describe('selectCapabilities · 直接入选', () => {
  it('严格大于阈值：等于阈值不入，高于才入；行为与函数分开', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.6, c2: 0.61, c3: 0, c4: 0, c5: 0, c6: 0.8 },
      0.6,
      [ontology()],
    );
    // B2 直接入选后触发其规则补充 Q3；B1 等于阈值被丢弃，故 Q1/Q2 不补
    expect(result.behaviors.map((item) => item.name)).toEqual(['B2', 'Q3']);
    expect(result.functions.map((item) => item.name)).toEqual(['F1']);
    expect(result.behaviors[0]!.score).toBe(0.61);
    expect(result.functions[0]!.kind).toBe('function');
  });

  it('分数降序、同分按原序', () => {
    const result = selectCapabilities(ALL, { c1: 0.7, c2: 0.9, c3: 0.7, c4: 0.7, c5: 0, c6: 0 }, 0.6, [ontology()]);
    // 4 个直接入选（B2/B1/Q1/Q2）+ B2 触发的补充 Q3
    expect(result.behaviors.map((item) => item.name)).toEqual(['B2', 'B1', 'Q1', 'Q2', 'Q3']);
  });

  it('缺失分数的候选不入选；直接入选的 B1 仍触发补充', () => {
    const result = selectCapabilities(ALL, { c1: 0.9 }, 0.6, [ontology()]);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1', 'Q1', 'Q2']);
    expect(result.behaviors[0]!.source).toBe('direct');
  });
});

describe('selectCapabilities · 数据补充', () => {
  it('只补直接入选行为：B2 未入选，其 R2 声明的 Q3 不出现', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.5, c3: 0.1, c4: 0.1, c5: 0.1, c6: 0 },
      0.6,
      [ontology()],
    );
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1', 'Q1', 'Q2']);
    expect(result.behaviors.map((item) => item.name)).not.toContain('Q3');
  });

  it('补充行为不受阈值约束，来源为 supplement，分数为 null', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.1, c3: 0.05, c4: 0.05, c5: 0.05, c6: 0 },
      0.6,
      [ontology()],
    );
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1', 'Q1', 'Q2']);
    expect(result.behaviors.slice(1).map((item) => item.source)).toEqual(['supplement', 'supplement']);
    expect(result.behaviors.slice(1).map((item) => item.score)).toEqual([null, null]);
    expect(result.supplements).toEqual([
      { ontologyId: '1', behavior: 'B1', supplement: 'Q1', found: true },
      { ontologyId: '1', behavior: 'B1', supplement: 'Q2', found: true },
      { ontologyId: '1', behavior: 'B1', supplement: 'MissingBehavior', found: false },
    ]);
  });

  it('不级联：补充项 Q1 自身的规则不触发（Q3 不出现）', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.1, c3: 0.05, c4: 0.05, c5: 0.05, c6: 0 },
      0.6,
      [ontology()],
    );
    expect(result.behaviors.map((item) => item.name)).not.toContain('Q3');
  });

  it('同一行为被多条规则声明同一补充：只留一项', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.1, c3: 0.05, c4: 0.05, c5: 0.05, c6: 0 },
      0.6,
      [ontology()],
    );
    expect(result.behaviors.filter((item) => item.name === 'Q1')).toHaveLength(1);
    expect(result.supplements.filter((item) => item.supplement === 'Q1')).toHaveLength(1);
  });

  it('直接入选与补充命中同一项：来源合并，分数保留最高', () => {
    const result = selectCapabilities(
      ALL,
      { c1: 0.9, c2: 0.1, c3: 0.8, c4: 0.05, c5: 0.05, c6: 0 },
      0.6,
      [ontology()],
    );
    const q1 = result.behaviors.find((item) => item.name === 'Q1')!;
    expect(q1.source).toBe('direct+supplement');
    expect(q1.score).toBe(0.8);
  });

  it('不校验 op_type：非 query 的补充行为仍按名字补入', () => {
    const custom = ontology();
    custom.rules = [{ behavior: 'B1', dataSupplements: ['B2'] }];
    const result = selectCapabilities(ALL, { c1: 0.9, c2: 0.1 }, 0.6, [custom]);
    expect(result.behaviors.map((item) => item.name)).toEqual(['B1', 'B2']);
  });

  it('去重键为 ontology_id + name：跨本体同名各自保留', () => {
    const other: OntologyDefinition = { ...ontology(), filePath: '/o/2.yaml', ontologyId: '2', rules: [] };
    const list: CapabilityCandidate[] = [
      ...ALL,
      {
        qid: 'c7',
        kind: 'behavior',
        name: 'B1',
        title: '创建采购单',
        ontologyId: '2',
        ontologyName: '另一个本体',
        index: 0,
      },
    ];
    const result = selectCapabilities(list, { c1: 0.9, c7: 0.95 }, 0.6, [ontology(), other]);
    const b1 = result.behaviors.filter((item) => item.name === 'B1');
    expect(b1).toHaveLength(2);
    expect(b1.map((item) => item.ontologyId)).toEqual(['2', '1']);
  });
});

describe('selectCapabilities · 类内去重', () => {
  it('函数同样按 ontology_id + name 去重，同键取最高分', () => {
    const list: CapabilityCandidate[] = [
      ...ALL,
      {
        qid: 'c7',
        kind: 'function',
        name: 'F1',
        title: '校验函数',
        ontologyId: '1',
        ontologyName: '原材料采购和库存',
        index: 1,
      },
    ];
    const result = selectCapabilities(list, { c6: 0.7, c7: 0.9 }, 0.6, [ontology()]);
    expect(result.functions).toHaveLength(1);
    expect(result.functions[0]!.score).toBe(0.9);
  });
});

describe('selectCapabilities · 上限', () => {
  it('去重后行为类超过 96：只截断补充项并置 truncated', () => {
    const behaviors = Array.from({ length: 100 }, (_, i) => ({
      name: `X${i}`,
      title: `行为${i}`,
      opType: 'command' as const,
    }));
    const big: OntologyDefinition = {
      ...ontology(),
      behaviors,
      functions: [],
      rules: [{ behavior: 'X0', dataSupplements: behaviors.map((item) => item.name) }],
    };
    const list = candidates(
      behaviors.map((item) => ['behavior', item.name] as [CapabilityCandidate['kind'], string]),
    );
    const scores: Record<string, number> = { c1: 0.9 };
    const result = selectCapabilities(list, scores, 0.6, [big]);
    expect(result.behaviors).toHaveLength(MAX_BEHAVIORS);
    expect(result.truncated).toBe(true);
    expect(result.behaviors[0]!.name).toBe('X0');
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
