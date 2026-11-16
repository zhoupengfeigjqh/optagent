/**
 * 单元测试：五元组路径构建（019 修订 2026-11-13）。
 *
 * 守住三件事：
 * 1. **形态**：一行就是 `行为—概念—关系—概念—行为`，五个元素齐全，该重复的起点行为重复；
 * 2. **语义**：`direction`（上游/下游）与 `readability`（关系名正读/反读）分开判定——
 *    N:1 的 `记录原材料` 从采购单走向原材料时是"朝上游"且"正读"，这两个维度不能混；
 * 3. **接续**：多跳逐跳产出，第 N 跳起点行为 = 第 N-1 跳终点行为；中间概念没行为就断。
 */
import { describe, expect, it } from 'vitest';

import { buildFocusPaths } from '../../src/domain/intent-focus/paths.js';
import type {
  ExpandedConcept,
  ExpansionResult,
  OntologyBehavior,
  OntologyDefinition,
  OntologyRelation,
} from '../../src/domain/intent-focus/types.js';

function relation(
  name: string,
  title: string,
  source: string,
  target: string,
  relationType: string[] = [],
  cardinality: string | null = null,
): OntologyRelation {
  return { name, title, source, target, relationType, cardinality };
}

function behavior(name: string, title: string, concept: string | null): OntologyBehavior {
  return { name, title, description: '', opType: 'query', concept };
}

/** 真实「原材料采购和库存」的骨架：采购单是明细，原材料/供应商/客户订单都是它的上游 */
function purchaseOntology(): OntologyDefinition {
  return {
    filePath: '/tmp/ontology.yaml',
    ontologyId: '1',
    ontologyName: '原材料采购和库存',
    scenarioId: '1',
    scenarioName: '生产调度',
    concepts: [
      { name: 'RawMaterial', title: '原材料' },
      { name: 'Supplier', title: '供应商' },
      { name: 'PurchaseRecord', title: '原材料采购记录' },
      { name: 'RawMaterialInventory', title: '原材料库存' },
      { name: 'CustomerOrder', title: '客户订单' },
      { name: 'DeliveryCapability', title: '供应商供货能力' },
    ],
    relations: [
      relation('HasRawInventory', '拥有库存', 'RawMaterial', 'RawMaterialInventory', [
        'Functional',
        'InverseFunctional',
      ], '1:1'),
      relation('RecordsRawMaterial', '记录原材料', 'PurchaseRecord', 'RawMaterial', ['Functional'], 'N:1'),
      relation('OrderedFromSupplier', '从...采购', 'PurchaseRecord', 'Supplier', ['Functional'], 'N:1'),
      relation('ContainsPurchaseRecord', '包含采购记录', 'CustomerOrder', 'PurchaseRecord', [
        'InverseFunctional',
      ], '1:N'),
      relation('HasCapability', '拥有供应能力', 'Supplier', 'DeliveryCapability', [
        'InverseFunctional',
      ], '1:N'),
    ],
    behaviors: [
      behavior('CreatePurchaseRecord', '创建原材料采购单', 'PurchaseRecord'),
      behavior('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord'),
      behavior('QueryRawMaterials', '查询原材料基本信息', 'RawMaterial'),
      behavior('QuerySuppliers', '查询供应商信息', 'Supplier'),
      behavior('QueryInventory', '查询库存信息', 'RawMaterialInventory'),
    ],
  };
}

function concept(
  name: string,
  title: string,
  viaConcept: string,
  viaRelation: string,
  hop = 1,
  ontologyId = '1',
): ExpandedConcept {
  return { ontologyId, ontologyName: '原材料采购和库存', name, title, hop, viaConcept, viaRelation };
}

function expansion(
  upstreamConcepts: ExpandedConcept[],
  upstreamBehaviors: ExpansionResult['upstream']['behaviors'] = [],
  downstreamConcepts: ExpandedConcept[] = [],
): ExpansionResult {
  return {
    upstream: { concepts: upstreamConcepts, behaviors: upstreamBehaviors },
    downstream: { concepts: downstreamConcepts, behaviors: [] },
    warnings: [],
    truncated: false,
  };
}

/** 采购单的三个上游：原材料、供应商、客户订单（客户订单下没有行为） */
function purchaseExpansion(): ExpansionResult {
  return expansion([
    concept('RawMaterial', '原材料', 'PurchaseRecord', 'RecordsRawMaterial'),
    concept('Supplier', '供应商', 'PurchaseRecord', 'OrderedFromSupplier'),
    concept('CustomerOrder', '客户订单', 'PurchaseRecord', 'ContainsPurchaseRecord'),
  ]);
}

const START = {
  ontologyId: '1',
  name: 'CreatePurchaseRecord',
  title: '创建原材料采购单',
  concept: 'PurchaseRecord',
  score: 92,
};

function build(expansionResult: ExpansionResult, direction: 'upstream' | 'downstream' = 'upstream') {
  return buildFocusPaths({
    behaviors: [START],
    ontologies: [purchaseOntology()],
    expansion: expansionResult,
    direction,
  });
}

describe('buildFocusPaths', () => {
  it('一行一个五元组：行为—概念—关系—概念—行为，五个元素齐全', () => {
    const paths = build(purchaseExpansion());
    expect(paths).toHaveLength(3);

    const [raw] = paths;
    expect(raw!.behavior).toEqual({ name: 'CreatePurchaseRecord', title: '创建原材料采购单' });
    expect(raw!.fromConcept).toEqual({ name: 'PurchaseRecord', title: '原材料采购记录' });
    expect(raw!.relation).toEqual({ name: 'RecordsRawMaterial', title: '记录原材料' });
    expect(raw!.toConcept).toEqual({ name: 'RawMaterial', title: '原材料' });
    expect(raw!.toBehavior).toEqual({ name: 'QueryRawMaterials', title: '查询原材料基本信息' });
    expect(raw!.hop).toBe(1);
    expect(raw!.score).toBe(92);
  });

  it('起点行为在每条路径里重复（严格五元组，不靠跨行拼读）', () => {
    const paths = build(purchaseExpansion());
    expect(paths.map((path) => path.behavior.name)).toEqual([
      'CreatePurchaseRecord',
      'CreatePurchaseRecord',
      'CreatePurchaseRecord',
    ]);
  });

  it('方向与读向分开：N:1 逆箭头走仍算上游，但关系名要正读', () => {
    const [raw] = build(purchaseExpansion());
    expect(raw!.direction).toBe('upstream');
    // source=PurchaseRecord 且起点就是 PurchaseRecord ⇒ 正读（"采购单 记录 原材料"）
    expect(raw!.readability).toBe('forward');
  });

  it('起点在 target 一端时关系名反读（客户订单 包含 采购单）', () => {
    const paths = build(purchaseExpansion());
    const customer = paths.find((path) => path.toConcept.name === 'CustomerOrder')!;
    expect(customer.direction).toBe('upstream');
    expect(customer.readability).toBe('reverse');
  });

  it('链尾概念没有行为：保留一行并置 toBehavior=null（断链要说清楚，不整行消失）', () => {
    const customer = build(purchaseExpansion()).find((path) => path.toConcept.name === 'CustomerOrder')!;
    expect(customer.toBehavior).toBeNull();
  });

  it('目标概念下有多个行为：每个行为一行（链尾信息完整）', () => {
    const ontology = purchaseOntology();
    ontology.behaviors.push(behavior('QuerySupplierCapability', '查询供应商供货能力', 'Supplier'));
    const paths = buildFocusPaths({
      behaviors: [START],
      ontologies: [ontology],
      expansion: purchaseExpansion(),
    });
    const supplier = paths.filter((path) => path.toConcept.name === 'Supplier');
    expect(supplier.map((path) => path.toBehavior?.name)).toEqual([
      'QuerySuppliers',
      'QuerySupplierCapability',
    ]);
  });

  it('入选行为没有概念：不参与发散（照常出现在「直接命中」）', () => {
    const paths = buildFocusPaths({
      behaviors: [{ ...START, concept: null }],
      ontologies: [purchaseOntology()],
      expansion: purchaseExpansion(),
    });
    expect(paths).toEqual([]);
  });

  it('节点缺失本体的行为不产生路径', () => {
    const paths = buildFocusPaths({
      behaviors: [{ ...START, ontologyId: '99' }],
      ontologies: [purchaseOntology()],
      expansion: purchaseExpansion(),
    });
    expect(paths).toEqual([]);
  });

  it('去重：同一 (起点行为, 关系, 终点概念, 终点行为) 只出现一次', () => {
    const duplicated = expansion([
      concept('RawMaterial', '原材料', 'PurchaseRecord', 'RecordsRawMaterial'),
      concept('RawMaterial', '原材料', 'PurchaseRecord', 'RecordsRawMaterial'),
    ]);
    expect(build(duplicated)).toHaveLength(1);
  });

  it('方向可选下游（卡片通道）：只消费 downstream 的产出', () => {
    const result = expansion(
      [concept('RawMaterial', '原材料', 'PurchaseRecord', 'RecordsRawMaterial')],
      [],
      [concept('RawMaterialInventory', '原材料库存', 'RawMaterial', 'HasRawInventory')],
    );
    const downstream = buildFocusPaths({
      behaviors: [
        {
          ontologyId: '1',
          name: 'QueryRawMaterials',
          title: '查询原材料基本信息',
          concept: 'RawMaterial',
          score: 88,
        },
      ],
      ontologies: [purchaseOntology()],
      expansion: result,
      direction: 'downstream',
    });
    expect(downstream).toHaveLength(1);
    expect(downstream[0]!.direction).toBe('downstream');
    expect(downstream[0]!.toConcept.name).toBe('RawMaterialInventory');
    // 起点就是 source 端 ⇒ 关系名正读（"原材料 拥有库存 库存"）
    expect(downstream[0]!.readability).toBe('forward');
  });

  it('关系缺失（本体被截断）：关系名回退 via_relation，读向保守按正读', () => {
    const missingRelation = expansion([
      concept('Supplier', '供应商', 'PurchaseRecord', 'VanishedRelation'),
    ]);
    const [path] = build(missingRelation);
    expect(path!.relation).toEqual({ name: 'VanishedRelation', title: 'VanishedRelation' });
    expect(path!.readability).toBe('forward');
  });

  it('确定性：同输入两次构建结果完全一致', () => {
    expect(build(purchaseExpansion())).toEqual(build(purchaseExpansion()));
  });
});

describe('buildFocusPaths 多跳（口径：行为接续）', () => {
  /** C ← B ← A 的两跳链：起点行为挂在 C 上，B 也有行为，A 有行为 */
  function chainOntology(behaviorOnB = true): OntologyDefinition {
    return {
      filePath: '/tmp/chain.yaml',
      ontologyId: '2',
      ontologyName: '两跳链',
      scenarioId: '1',
      scenarioName: 'S',
      concepts: [
        { name: 'A', title: '甲' },
        { name: 'B', title: '乙' },
        { name: 'C', title: '丙' },
      ],
      relations: [
        relation('AtoB', '甲到乙', 'A', 'B', ['InverseFunctional'], '1:N'),
        relation('BtoC', '乙到丙', 'B', 'C', ['InverseFunctional'], '1:N'),
      ],
      behaviors: [
        behavior('C1', '丙行为', 'C'),
        ...(behaviorOnB ? [behavior('B1', '乙行为', 'B')] : []),
        behavior('A1', '甲行为', 'A'),
      ],
    };
  }

  function chainExpansion(): ExpansionResult {
    return {
      upstream: {
        concepts: [
          concept('B', '乙', 'C', 'BtoC', 1, '2'),
          concept('A', '甲', 'B', 'AtoB', 2, '2'),
        ],
        behaviors: [],
      },
      downstream: { concepts: [], behaviors: [] },
      warnings: [],
      truncated: false,
    };
  }

  const CHAIN_START = {
    ontologyId: '2',
    name: 'C1',
    title: '丙行为',
    concept: 'C',
    score: 70,
  };

  it('逐跳产出两条五元组，不是一条七元组', () => {
    const paths = buildFocusPaths({
      behaviors: [CHAIN_START],
      ontologies: [chainOntology()],
      expansion: chainExpansion(),
    });
    expect(paths).toHaveLength(2);

    // 第 1 跳：C1（丙）—BtoC→ 乙 —B1
    expect(paths[0]!.hop).toBe(1);
    expect(paths[0]!.behavior.name).toBe('C1');
    expect(paths[0]!.fromConcept.name).toBe('C');
    expect(paths[0]!.toConcept.name).toBe('B');
    expect(paths[0]!.toBehavior?.name).toBe('B1');

    // 第 2 跳：起点行为 = 上一跳的终点行为 B1，起点概念 = 上一跳终点概念 B
    expect(paths[1]!.hop).toBe(2);
    expect(paths[1]!.behavior.name).toBe('B1');
    expect(paths[1]!.fromConcept.name).toBe('B');
    expect(paths[1]!.relation.name).toBe('AtoB');
    expect(paths[1]!.toConcept.name).toBe('A');
    expect(paths[1]!.toBehavior?.name).toBe('A1');
    // 接续出来的起点行为没有聚焦得分
    expect(paths[1]!.score).toBeNull();
  });

  it('中间概念没有行为：第 1 跳保留空终点，且不再向下展开', () => {
    const paths = buildFocusPaths({
      behaviors: [CHAIN_START],
      ontologies: [chainOntology(false)],
      expansion: chainExpansion(),
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]!.toConcept.name).toBe('B');
    expect(paths[0]!.toBehavior).toBeNull();
  });
});
