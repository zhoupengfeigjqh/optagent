import { describe, expect, it } from 'vitest';

import {
  buildToolNameIndex,
  normalizePlan,
  resolveToolNames,
  type NormalizeDeps,
  type OntologyFacts,
} from '../../src/domain/plan/normalize.js';
import type { RawStep } from '../../src/domain/plan/types.js';
import type { BehaviorLookup } from '../../src/domain/rule-gate/types.js';

const TOOLS = [
  { name: 'rawmcp__QueryInventory' },
  { name: 'rawmcp__CreatePurchaseRecord' },
  { name: 'rawmcp__sumRawNotArrivalQty' },
  { name: 'rawmcp__checkSafetyStock' },
  { name: 'rawmcp__QueryPurchaseRecords' },
  { name: 'rawmcp__calcLeadTime' },
];

const INDEX = buildToolNameIndex(TOOLS);

const REF = {
  ontologyKey: 'scenario-a/ontology-1',
  scenarioName: 'scenario-a',
  ontologyName: 'ontology-1',
  behaviorName: 'CreatePurchaseRecord',
};

function lookup(toolName: string): BehaviorLookup | null {
  if (toolName === 'rawmcp__QueryInventory') {
    return { toolName, command: false, relatedFunctions: [], ref: REF };
  }
  if (toolName === 'rawmcp__CreatePurchaseRecord') {
    return {
      toolName,
      command: true,
      relatedFunctions: ['sumRawNotArrivalQty', 'checkSafetyStock'],
      ref: REF,
    };
  }
  return null;
}

const FACTS: OntologyFacts = {
  relatedConceptsOf(functionName) {
    if (functionName === 'sumRawNotArrivalQty') return ['PurchaseRecord'];
    if (functionName === 'checkSafetyStock') return ['RawMaterialInventory'];
    if (functionName === 'calcLeadTime') return ['DeliveryCapability'];
    return [];
  },
  ontologyKeysOfFunction() {
    return ['scenario-a/ontology-1'];
  },
  queryBehaviorsOf(concept) {
    if (concept === 'PurchaseRecord') return ['QueryPurchaseRecords'];
    if (concept === 'RawMaterialInventory') return ['QueryInventory'];
    if (concept === 'DeliveryCapability') return ['QueryInventory'];
    return [];
  },
};

function deps(overrides: Partial<NormalizeDeps> = {}): NormalizeDeps {
  let seq = 0;
  return {
    nameIndex: INDEX,
    behaviorOf: lookup,
    facts: FACTS,
    nextSeqId: () => {
      seq += 1;
      return seq;
    },
    ...overrides,
  };
}

function raw(coreAction: string, type = 'query'): RawStep {
  return { seqId: 1, taskName: '步骤', content: '内容', coreAction, type };
}

describe('resolveToolNames', () => {
  it('裸名、完整名、归一键都能解析到同一个原样名', () => {
    for (const name of ['QueryInventory', 'rawmcp__QueryInventory', 'queryinventory']) {
      expect(resolveToolNames(name, INDEX)).toEqual(['rawmcp__QueryInventory']);
    }
  });

  it('多服务同名 → 返回多个候选（交给 C0 判歧义）', () => {
    const index = buildToolNameIndex([{ name: 'svc-a__QueryInventory' }, { name: 'svc-b__QueryInventory' }]);
    expect(resolveToolNames('QueryInventory', index)).toHaveLength(2);
  });
});

describe('normalizePlan', () => {
  it('coreAction 存原样完整名，label 保留裸名', () => {
    const result = normalizePlan([raw('QueryInventory')], deps());
    expect(result.failures).toEqual([]);
    expect(result.steps[0]?.coreAction).toBe('rawmcp__QueryInventory');
    expect(result.steps[0]?.coreActionLabel).toBe('QueryInventory');
  });

  it('回归：输入是归一键时也必须还原成原样名', () => {
    const result = normalizePlan([raw('rawmcp__queryinventory')], deps());
    expect(result.steps[0]?.coreAction).toBe('rawmcp__QueryInventory');
  });

  it('无匹配 → C0 失败', () => {
    const result = normalizePlan([raw('NotExists')], deps());
    expect(result.steps).toEqual([]);
    expect(result.failures[0]?.code).toBe('C0');
    expect(result.failures[0]?.seqId).toBe(1);
  });

  it('多候选 → C0 失败并列出候选', () => {
    const index = buildToolNameIndex([{ name: 'svc-a__QueryInventory' }, { name: 'svc-b__QueryInventory' }]);
    const result = normalizePlan([raw('QueryInventory')], deps({ nameIndex: index }));
    expect(result.failures[0]?.code).toBe('C0');
    expect(result.failures[0]?.detail).toContain('svc-a__QueryInventory');
  });

  it('type 三分：command / query / function', () => {
    const steps = normalizePlan(
      [raw('CreatePurchaseRecord', 'command'), raw('QueryInventory', 'query'), raw('calcLeadTime', 'function')],
      deps(),
    ).steps;
    expect(steps.map((step) => step.type)).toEqual(['command', 'query', 'function']);
  });

  it('command 的 dependTools = 前置函数 + 其关联概念的 query 行为（去重、不含自身）', () => {
    const step = normalizePlan([raw('CreatePurchaseRecord', 'command')], deps()).steps[0];
    expect(step?.dependTools).toEqual([
      'rawmcp__sumRawNotArrivalQty',
      'rawmcp__checkSafetyStock',
      'rawmcp__QueryPurchaseRecords',
      'rawmcp__QueryInventory',
    ]);
    expect(step?.dependTools).not.toContain('rawmcp__CreatePurchaseRecord');
  });

  it('query 的 dependTools 为空', () => {
    expect(normalizePlan([raw('QueryInventory')], deps()).steps[0]?.dependTools).toEqual([]);
  });

  it('本体函数的 dependTools = 关联概念的 query 行为', () => {
    const step = normalizePlan([raw('calcLeadTime', 'function')], deps()).steps[0];
    expect(step?.type).toBe('function');
    expect(step?.dependTools).toEqual(['rawmcp__QueryInventory']);
  });

  it('非本体工具（无关联概念）的 dependTools 为空', () => {
    const index = buildToolNameIndex([...TOOLS, { name: 'read_file' }]);
    const step = normalizePlan([raw('read_file', 'function')], deps({ nameIndex: index })).steps[0];
    expect(step?.dependTools).toEqual([]);
  });

  it('依赖不可解析 → C3 失败', () => {
    const facts: OntologyFacts = {
      ...FACTS,
      relatedConceptsOf: () => ['PurchaseRecord'],
      queryBehaviorsOf: () => ['NotMountedBehavior'],
    };
    const result = normalizePlan([raw('CreatePurchaseRecord', 'command')], deps({ facts }));
    expect(result.failures.map((failure) => failure.code)).toContain('C3');
  });

  it('seqId 由外部计数器分配（跨批连续）', () => {
    let seq = 10;
    const shared = deps({
      nextSeqId: () => {
        seq += 1;
        return seq;
      },
    });
    const first = normalizePlan([raw('QueryInventory')], shared).steps[0];
    const second = normalizePlan([raw('QueryInventory')], shared).steps[0];
    expect(first?.seqId).toBe(11);
    expect(second?.seqId).toBe(12);
  });

  it('同输入两次调用结果相同（除 seqId）', () => {
    const first = normalizePlan([raw('CreatePurchaseRecord', 'command')], deps()).steps[0];
    const second = normalizePlan([raw('CreatePurchaseRecord', 'command')], deps()).steps[0];
    expect({ ...first, seqId: 0 }).toEqual({ ...second, seqId: 0 });
  });
});
