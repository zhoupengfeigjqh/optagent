/**
 * 单元测试：关联概念取数（2026-11-20，FR-066 / FR-067）。
 *
 * 覆盖的全是"取错了会悄悄污染提示"的分支：
 * - 只认 `op_type: query`（command 是写操作，不能当取数）；
 * - 一个概念下有多个 query 行为时全取，不能只取第一条；
 * - 已被行为直接命中的不再重复（以直接命中为准）；
 * - 多函数共享概念只出一次；
 * - 只认同本体（跨本体同名概念不串）；
 * - 悬空概念给空结果，不抛错。
 */
import { describe, expect, it } from 'vitest';
import { resolveConceptQueries } from '../../src/domain/intent-focus/concept-queries.js';
import type {
  FunctionDecision,
  OntologyDefinition,
} from '../../src/domain/intent-focus/types.js';

function ontology(overrides: Partial<OntologyDefinition> = {}): OntologyDefinition {
  return {
    filePath: '/o/1.yaml',
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    scenarioId: '2',
    scenarioName: '生产调度',
    behaviors: [
      { name: 'Q1', title: '查询采购记录', description: '', opType: 'query', concept: 'PurchaseRecord' },
      { name: 'C1', title: '创建采购单', description: '', opType: 'command', concept: 'PurchaseRecord' },
      { name: 'Q2', title: '查询采购记录明细', description: '', opType: 'Query', concept: 'PurchaseRecord' },
      { name: 'Q3', title: '查询 supplier', description: '', opType: ' query ', concept: 'Supplier' },
      { name: 'Q4', title: '查询库存', description: '', opType: 'query', concept: 'RawMaterialInventory' },
    ],
    functions: [],
    concepts: [],
    relations: [],
    ...overrides,
  };
}

function fn(
  name: string,
  relatedConcepts: string[],
  overrides: Partial<FunctionDecision> = {},
): FunctionDecision {
  return {
    name,
    title: name,
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    score: 0.9,
    relatedConcepts,
    index: 0,
    ...overrides,
  };
}

describe('resolveConceptQueries', () => {
  it('只取 query 行为（command 不入选，大小写与空白归一）', () => {
    const result = resolveConceptQueries([fn('F1', ['PurchaseRecord'])], [ontology()]);

    expect(result.map((item) => item.name)).toEqual(['Q1', 'Q2']);
  });

  it('空 related_concepts → 空结果', () => {
    expect(resolveConceptQueries([fn('F1', [])], [ontology()])).toEqual([]);
  });

  it('没有函数 → 空结果（不遍历本体）', () => {
    expect(resolveConceptQueries([], [ontology()])).toEqual([]);
  });

  it('一条取数项的 score 为空（不判分），但保留所属概念与本体', () => {
    const [first] = resolveConceptQueries([fn('F1', ['Supplier'])], [ontology()]);

    expect(first).toMatchObject({
      name: 'Q3',
      concept: 'Supplier',
      ontologyId: '1',
      ontologyName: '原材料采购和库存',
    });
    expect(first).not.toHaveProperty('score');
  });

  it('已被行为直接命中的 query 行为不重复出现', () => {
    const result = resolveConceptQueries(
      [fn('F1', ['PurchaseRecord', 'Supplier'])],
      [ontology()],
      [{ ontologyId: '1', name: 'Q1' }],
    );

    expect(result.map((item) => item.name)).toEqual(['Q2', 'Q3']);
  });

  it('多函数共享同一概念时只出一次（跨函数的去重）', () => {
    const result = resolveConceptQueries(
      [fn('F1', ['Supplier']), fn('F2', ['Supplier'])],
      [ontology()],
    );

    expect(result.map((item) => item.name)).toEqual(['Q3']);
  });

  it('只认同本体：另一个本体的同名概念不串', () => {
    const other = ontology({
      filePath: '/o/2.yaml',
      ontologyId: '2',
      ontologyName: '另一个本体',
      behaviors: [
        { name: 'QX', title: '查询供应商', description: '', opType: 'query', concept: 'Supplier' },
      ],
    });
    const result = resolveConceptQueries([fn('F1', ['Supplier'])], [ontology(), other]);

    expect(result.map((item) => item.name)).toEqual(['Q3']);
    expect(result.every((item) => item.ontologyId === '1')).toBe(true);
  });

  it('悬空概念（概念不在本体里）→ 空结果，不抛错', () => {
    const result = resolveConceptQueries([fn('F1', ['NotExist'])], [ontology()]);

    expect(result).toEqual([]);
  });

  it('同 ontology_id 多份文件按行为名去重，保留枚举序首份', () => {
    const duplicate = ontology({ filePath: '/o/1-copy.yaml' });
    const result = resolveConceptQueries([fn('F1', ['PurchaseRecord'])], [ontology(), duplicate]);

    expect(result.map((item) => item.name)).toEqual(['Q1', 'Q2']);
  });
});
