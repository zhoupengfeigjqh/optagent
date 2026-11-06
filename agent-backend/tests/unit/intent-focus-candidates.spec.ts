/**
 * 单元测试：候选构造与题面（016）。
 *
 * 守住的边界：
 * - 非本体技能一律可聚焦；本体技能只有 `ontology_id` 命中索引才可聚焦（否则不评分）；
 * - 行为只来自入选技能引用的本体，同本体多技能只收集一次；
 * - 题面只用 `title`（缺失降级 `name`），不含 `op_type`；题号 `s1..` / `c1..` 唯一且连续；
 * - 总数与单批上限都按配置生效。
 *
 * 2026-11-06：候选只来自 `behaviors[]`，题面标签固定为「行为」。
 */
import { describe, expect, it } from 'vitest';
import {
  batchQuestions,
  buildCapabilityCandidates,
  buildCapabilityQuestions,
  buildSkillCandidates,
  buildSkillQuestions,
} from '../../src/domain/intent-focus/candidates.js';
import type {
  OntologyDefinition,
  OntologyIndex,
  SkillHeaderLike,
} from '../../src/domain/intent-focus/types.js';

function header(overrides: Partial<SkillHeaderLike['metadata']> & { name?: string } = {}): SkillHeaderLike {
  return {
    name: overrides.name ?? 'skill',
    description: `${overrides.name ?? 'skill'} 的用途`,
    dirName: overrides.name ?? 'skill',
    metadata: {
      ontologyId: overrides.ontologyId ?? null,
      ontologyName: overrides.ontologyName ?? null,
      scenarioId: overrides.scenarioId ?? null,
      scenarioName: overrides.scenarioName ?? null,
    },
  };
}

function ontology(overrides: Partial<OntologyDefinition> = {}): OntologyDefinition {
  return {
    filePath: `/o/${overrides.ontologyId ?? '1'}.yaml`,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    scenarioId: '2',
    scenarioName: '生产调度',
    behaviors: [
      { name: 'CreatePurchaseRecord', title: '创建原材料采购单', opType: 'command' },
      { name: 'QueryPurchaseRecords', title: '查询原材料采购单信息', opType: 'query' },
    ],
    ...overrides,
  };
}

function index(definitions: OntologyDefinition[]): OntologyIndex {
  const byId = new Map<string, OntologyDefinition[]>();
  for (const definition of definitions) {
    const bucket = byId.get(definition.ontologyId);
    if (bucket) bucket.push(definition);
    else byId.set(definition.ontologyId, [definition]);
  }
  return { byId, all: definitions, warnings: [] };
}

describe('buildSkillCandidates', () => {
  it('非本体技能进入；命中本体的本体技能进入；未命中者排除且带原因', () => {
    const result = buildSkillCandidates(
      [
        header({ name: 'plain' }),
        header({ name: 'onto', ontologyId: '1', ontologyName: '原材料采购和库存' }),
        header({ name: 'orphan', ontologyId: '404', ontologyName: '不存在的本体' }),
      ],
      index([ontology()]),
      32,
    );

    expect(result.candidates.map((candidate) => candidate.header.name)).toEqual(['plain', 'onto']);
    expect(result.candidates.map((candidate) => candidate.qid)).toEqual(['s1', 's2']);
    expect(result.excluded.map((decision) => decision.header.name)).toEqual(['orphan']);
    expect(result.excluded[0]!.reason).toBe('no_matching_ontology');
    expect(result.excluded[0]!.score).toBeNull();
    expect(result.truncated).toBe(false);
  });

  it('本体技能与同 ID 的多个本体全部绑定', () => {
    const result = buildSkillCandidates(
      [header({ name: 'onto', ontologyId: '1', ontologyName: '原材料采购和库存' })],
      index([ontology(), ontology({ ontologyName: '同 ID 第二份' })]),
      32,
    );
    expect(result.candidates[0]!.matchedOntologies).toHaveLength(2);
  });

  it('技能总数上限生效并标 truncated', () => {
    const result = buildSkillCandidates(
      [header({ name: 'a' }), header({ name: 'b' }), header({ name: 'c' })],
      index([]),
      2,
    );
    expect(result.candidates).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('技能题面只用 description（不含 name 前缀），判据为 需要/不需要', () => {
    const result = buildSkillCandidates([header({ name: 'a' })], index([]), 32);
    const questions = buildSkillQuestions(result.candidates);
    expect(questions.s1!.instructions).toBe('需要技能「a 的用途」');
    expect(questions.s1!.criteria).toEqual({ true: '需要', false: '不需要' });
  });
});

describe('buildCapabilityCandidates', () => {
  const skills = buildSkillCandidates(
    [header({ name: 'onto', ontologyId: '1', ontologyName: '原材料采购和库存' })],
    index([ontology()]),
    32,
  ).candidates;

  it('只收集入选本体技能引用的本体，且只收行为', () => {
    const result = buildCapabilityCandidates(skills, index([ontology()]), 96);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      'CreatePurchaseRecord',
      'QueryPurchaseRecords',
    ]);
    expect(result.candidates.map((candidate) => candidate.qid)).toEqual(['c1', 'c2']);
    // 2026-11-06：候选不再带类别字段
    expect(result.candidates[0]).not.toHaveProperty('kind');
  });

  it('题面只用 title，不含 name 与 op_type；title 缺失时降级为 name', () => {
    const result = buildCapabilityCandidates(skills, index([ontology()]), 96);
    const questions = buildCapabilityQuestions(result.candidates);
    expect(questions.c1!.instructions).toBe('需要行为「创建原材料采购单」');
    // op_type（command）不进题面
    expect(JSON.stringify(questions)).not.toContain('command');
    // title 缺失 → 降级为 name（英文标识符）
    const noTitle = buildCapabilityQuestions([
      { qid: 'x1', name: 'DoThing', title: '', ontologyId: '1', ontologyName: null, index: 0 },
    ]);
    expect(noTitle.x1!.instructions).toBe('需要行为「DoThing」');
  });

  it('非本体技能不贡献行为候选', () => {
    const plain = buildSkillCandidates([header({ name: 'plain' })], index([ontology()]), 32).candidates;
    expect(buildCapabilityCandidates(plain, index([ontology()]), 96).candidates).toEqual([]);
  });

  it('候选层按 ontology_id + name 去重：同本体多文件不重复出题', () => {
    const copy = ontology({ filePath: '/o/1-copy.yaml' });
    const result = buildCapabilityCandidates(skills, index([ontology(), copy]), 96);
    expect(result.candidates.map((candidate) => candidate.qid)).toEqual(['c1', 'c2']);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      'CreatePurchaseRecord',
      'QueryPurchaseRecords',
    ]);
  });

  it('同名但不同本体各自保留（去重键含 ontology_id）', () => {
    const other = ontology({ ontologyId: '2', filePath: '/o/2.yaml' });
    const both = buildSkillCandidates(
      [
        header({ name: 'a', ontologyId: '1', ontologyName: '原材料采购和库存' }),
        header({ name: 'b', ontologyId: '2', ontologyName: '另一个本体' }),
      ],
      index([ontology(), other]),
      32,
    ).candidates;
    const result = buildCapabilityCandidates(both, index([ontology(), other]), 96);
    const creates = result.candidates.filter((candidate) => candidate.name === 'CreatePurchaseRecord');
    expect(creates.map((candidate) => candidate.ontologyId)).toEqual(['1', '2']);
  });

  it('上限按配置截断（原序）', () => {
    const result = buildCapabilityCandidates(skills, index([ontology()]), 1);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(['CreatePurchaseRecord']);
    expect(result.truncated).toBe(true);
  });
});

describe('batchQuestions', () => {
  it('按 32 切批，题号保持稳定且不丢失', () => {
    const candidates = Array.from({ length: 33 }, (_, i) => ({ qid: `s${i + 1}` }));
    const questions = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.qid,
        { type: 'noul' as const, instructions: candidate.qid, criteria: { true: '需要', false: '不需要' } },
      ]),
    );
    const batches = batchQuestions(candidates, questions, 32);
    expect(batches).toHaveLength(2);
    expect(Object.keys(batches[0]!)).toHaveLength(32);
    expect(Object.keys(batches[1]!)).toEqual(['s33']);
  });
});
