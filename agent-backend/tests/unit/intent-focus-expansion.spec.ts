/**
 * 单元测试：一阶发散（019）。
 *
 * 守住四件事：
 * 1. **方向判定唯一实现**：`Functional` 单独 → 反向（target 是上游）；其余（1:N / 1:1 / M:N）
 *    → 箭头方向（source 是上游）；信号缺失时依次退回 `cardinality` → 箭头；
 * 2. **同向 BFS**：只走一个方向，`hop` 正确，`visited` 去环，同跳按 `concepts[]` 原序；
 * 3. **direct 优先**：直接命中的行为不会以发散身份重复出现，直接命中的概念也不会再当发散概念；
 * 4. **行为有界、概念无界**：超限只截断行为并标 `truncated`。
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_EXPANDED_BEHAVIORS,
  clampDepth,
  expandNeighborhood,
  relationEnds,
} from '../../src/domain/intent-focus/expansion.js';
import type { OntologyBehavior, OntologyDefinition } from '../../src/domain/intent-focus/types.js';

function behavior(name: string, title: string, concept: string | null): OntologyBehavior {
  return { name, title, description: '', opType: 'query', concept };
}

/** 与仓内真实 `ontology.yaml` 同形的 6 概念 / 5 关系 / 8 行为 */
function ontology(overrides: Partial<OntologyDefinition> = {}): OntologyDefinition {
  return {
    filePath: 'ontology/生产调度/原材料采购和库存/ontology.yaml',
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
      { name: 'DeliveryCapability', title: '交货能力' },
    ],
    relations: [
      {
        name: 'HasRawInventory',
        source: 'RawMaterial',
        target: 'RawMaterialInventory',
        relationType: ['Functional', 'InverseFunctional'],
        cardinality: '1:1',
      },
      {
        name: 'RecordsRawMaterial',
        source: 'PurchaseRecord',
        target: 'RawMaterial',
        relationType: ['Functional'],
        cardinality: 'N:1',
      },
      {
        name: 'OrderedFromSupplier',
        source: 'PurchaseRecord',
        target: 'Supplier',
        relationType: ['Functional'],
        cardinality: 'N:1',
      },
      {
        name: 'ContainsPurchaseRecord',
        source: 'CustomerOrder',
        target: 'PurchaseRecord',
        relationType: ['InverseFunctional'],
        cardinality: '1:N',
      },
      {
        name: 'HasCapability',
        source: 'Supplier',
        target: 'DeliveryCapability',
        relationType: ['InverseFunctional'],
        cardinality: '1:N',
      },
    ],
    behaviors: [
      behavior('QueryRawMaterials', '查询原材料基本信息', 'RawMaterial'),
      behavior('QuerySuppliers', '查询供应商信息', 'Supplier'),
      behavior('CreatePurchaseRecord', '创建原材料采购单', 'PurchaseRecord'),
      behavior('CancelPurchaseRecord', '取消原材料采购单', 'PurchaseRecord'),
      behavior('ReceiveRawMaterial', '入库原材料', 'PurchaseRecord'),
      behavior('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord'),
      behavior('QueryInventory', '查询原材料库存信息', 'RawMaterialInventory'),
      behavior('QuerySupplierCapability', '查询供应商供货能力', 'DeliveryCapability'),
    ],
    ...overrides,
  };
}

describe('relationEnds：方向推定的唯一实现', () => {
  it('Functional 单独（N:1）反向取：target 是上游', () => {
    const ends = relationEnds({
      name: 'RecordsRawMaterial',
      source: 'PurchaseRecord',
      target: 'RawMaterial',
      relationType: ['Functional'],
      cardinality: 'N:1',
    });
    expect(ends).toEqual({ upstream: 'RawMaterial', downstream: 'PurchaseRecord', via: 'relation_type' });
  });

  it('InverseFunctional（1:N）按箭头：source 是上游', () => {
    const ends = relationEnds({
      name: 'ContainsPurchaseRecord',
      source: 'CustomerOrder',
      target: 'PurchaseRecord',
      relationType: ['InverseFunctional'],
      cardinality: '1:N',
    });
    expect(ends).toEqual({ upstream: 'CustomerOrder', downstream: 'PurchaseRecord', via: 'relation_type' });
  });

  it('1:1（两者都有）按箭头：source 是主体 → 上游', () => {
    const ends = relationEnds({
      name: 'HasRawInventory',
      source: 'RawMaterial',
      target: 'RawMaterialInventory',
      relationType: ['Functional', 'InverseFunctional'],
      cardinality: '1:1',
    });
    expect(ends.upstream).toBe('RawMaterial');
    expect(ends.downstream).toBe('RawMaterialInventory');
    expect(ends.via).toBe('relation_type');
  });

  it('M:N 无基数约束：按约定取箭头方向（source 为上游）', () => {
    const ends = relationEnds({
      name: 'UsesMaterial',
      source: 'PurchaseRecord',
      target: 'RawMaterial',
      relationType: [],
      cardinality: 'N:M',
    });
    expect(ends).toEqual({ upstream: 'PurchaseRecord', downstream: 'RawMaterial', via: 'cardinality' });
  });

  it('relation_type 缺失时用 cardinality 兜底', () => {
    expect(
      relationEnds({
        name: 'x',
        source: 'A',
        target: 'B',
        relationType: [],
        cardinality: 'N:1',
      }).via,
    ).toBe('cardinality');
    expect(
      relationEnds({ name: 'x', source: 'A', target: 'B', relationType: [], cardinality: 'N:1' }).upstream,
    ).toBe('B');
  });

  it('两种信号都缺时退回箭头并标记 via=arrow', () => {
    const ends = relationEnds({
      name: 'x',
      source: 'A',
      target: 'B',
      relationType: [],
      cardinality: null,
    });
    expect(ends).toEqual({ upstream: 'A', downstream: 'B', via: 'arrow' });
  });
});

describe('clampDepth', () => {
  it('收敛到 0~2；非法值回到 0', () => {
    expect(clampDepth(0)).toBe(0);
    expect(clampDepth(1)).toBe(1);
    expect(clampDepth(2)).toBe(2);
    expect(clampDepth(3)).toBe(2);
    expect(clampDepth(-1)).toBe(0);
    expect(clampDepth(1.5)).toBe(0);
    expect(clampDepth(Number.NaN)).toBe(0);
  });
});

describe('expandNeighborhood', () => {
  it('阶数 0：不解析、不扩展', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryRawMaterials', concept: 'RawMaterial' }],
      ontologies: [ontology()],
      depth: 0,
    });
    expect(result.upstream.concepts).toEqual([]);
    expect(result.upstream.behaviors).toEqual([]);
    expect(result.downstream.concepts).toEqual([]);
    expect(result.downstream.behaviors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('上游一阶：库存 → 原材料（主数据），下游为空', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryInventory', concept: 'RawMaterialInventory' }],
      ontologies: [ontology()],
      depth: 1,
    });

    expect(result.upstream.concepts.map((item) => item.name)).toEqual(['RawMaterial']);
    expect(result.upstream.behaviors.map((item) => item.name)).toEqual(['QueryRawMaterials']);
    expect(result.upstream.concepts[0]).toMatchObject({
      hop: 1,
      viaConcept: 'RawMaterialInventory',
      viaRelation: 'HasRawInventory',
      title: '原材料',
    });
    expect(result.downstream.concepts).toEqual([]);
    expect(result.downstream.behaviors).toEqual([]);
  });

  it('下游一阶：原材料 → 库存 + 采购记录（明细），上游为空', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryRawMaterials', concept: 'RawMaterial' }],
      ontologies: [ontology()],
      depth: 1,
    });

    expect(result.upstream.concepts).toEqual([]);
    // 同跳按 concepts[] 原序：采购记录在库存之前
    expect(result.downstream.concepts.map((item) => item.name)).toEqual([
      'PurchaseRecord',
      'RawMaterialInventory',
    ]);
    expect(result.downstream.behaviors.map((item) => item.name)).toEqual([
      'CreatePurchaseRecord',
      'CancelPurchaseRecord',
      'ReceiveRawMaterial',
      'QueryPurchaseRecords',
      'QueryInventory',
    ]);
    expect(result.downstream.behaviors[0]).toMatchObject({
      hop: 1,
      viaConcept: 'PurchaseRecord',
      concept: 'PurchaseRecord',
    });
  });

  it('直接命中的行为不会以发散身份重复出现', () => {
    const result = expandNeighborhood({
      behaviors: [
        { ontologyId: '1', name: 'QueryRawMaterials', concept: 'RawMaterial' },
        { ontologyId: '1', name: 'QueryInventory', concept: 'RawMaterialInventory' },
      ],
      ontologies: [ontology()],
      depth: 1,
    });
    // 原材料的下游里，库存已是 direct 概念 → 不再作为发散概念；其行为也不再重复
    expect(result.downstream.concepts.map((item) => item.name)).toEqual(['PurchaseRecord']);
    expect(result.downstream.behaviors.map((item) => item.name)).not.toContain('QueryInventory');
    expect(result.downstream.behaviors.map((item) => item.name)).not.toContain('QueryRawMaterials');
  });

  it('二阶沿同向链继续走：采购记录 → 入库单 → 结算单', () => {
    const chain = ontology({
      concepts: [
        { name: 'PurchaseRecord', title: '原材料采购记录' },
        { name: 'InboundOrder', title: '入库单' },
        { name: 'Settlement', title: '结算单' },
      ],
      relations: [
        {
          name: 'HasInboundOrder',
          source: 'PurchaseRecord',
          target: 'InboundOrder',
          relationType: ['InverseFunctional'],
          cardinality: '1:N',
        },
        {
          name: 'SettleInbound',
          source: 'InboundOrder',
          target: 'Settlement',
          relationType: ['InverseFunctional'],
          cardinality: '1:N',
        },
      ],
      behaviors: [
        behavior('QueryPurchaseRecords', '查询原材料采购单信息', 'PurchaseRecord'),
        behavior('QueryInboundOrders', '查询入库单', 'InboundOrder'),
        behavior('QuerySettlements', '查询结算单', 'Settlement'),
      ],
    });

    const one = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryPurchaseRecords', concept: 'PurchaseRecord' }],
      ontologies: [chain],
      depth: 1,
    });
    expect(one.downstream.concepts.map((item) => item.name)).toEqual(['InboundOrder']);

    const two = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryPurchaseRecords', concept: 'PurchaseRecord' }],
      ontologies: [chain],
      depth: 2,
    });
    expect(two.downstream.concepts.map((item) => `${item.name}@${item.hop}`)).toEqual([
      'InboundOrder@1',
      'Settlement@2',
    ]);
    expect(two.downstream.behaviors.map((item) => item.hop)).toEqual([1, 2]);
  });

  it('概念未在 concepts[] 定义时断链并记 warning（不猜）', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryGhost', concept: 'Ghost' }],
      ontologies: [ontology()],
      depth: 1,
    });
    expect(result.warnings).toContain('1:concept_undefined:Ghost');
    expect(result.upstream.concepts).toEqual([]);
    expect(result.downstream.concepts).toEqual([]);
  });

  it('行为缺少 concept 时记 warning，判定与发散互不影响', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryLeaderless', concept: null }],
      ontologies: [ontology()],
      depth: 1,
    });
    expect(result.warnings).toContain('1:behavior_without_concept:QueryLeaderless');
  });

  it('行为超限按「概念序 → 行为原序」截断并标 truncated', () => {
    const result = expandNeighborhood({
      behaviors: [{ ontologyId: '1', name: 'QueryRawMaterials', concept: 'RawMaterial' }],
      ontologies: [ontology()],
      depth: 1,
      maxBehaviors: 2,
    });
    expect(result.truncated).toBe(true);
    expect(result.downstream.behaviors).toHaveLength(2);
    expect(result.downstream.concepts).toHaveLength(2);
  });

  it('默认上限存在（防止稠密本体把提示与卡片目录撑爆）', () => {
    expect(MAX_EXPANDED_BEHAVIORS).toBeGreaterThan(0);
  });
});
