/**
 * 单元测试：本体事实索引（028 T203s，FR-009 的数据来源）。
 *
 * 守住的口径：
 * - `dependTools` 只吃 `related_concepts` 与 `behaviors[].concept`（闸门侧读不到，故必须用意图聚焦侧索引）；
 * - 只有 `op_type: query` 的行为算"取数入口"，command 不算；
 * - 同名跨本体按名合并（同名即同一工具），本体维度只作优先匹配、对不上时回退全量；
 * - 目录签名不变时复用同一份缓存对象。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { OntologyDefinition, OntologyIndex } from '../../src/domain/intent-focus/types.js';
import {
  buildOntologyFacts,
  createOntologyFactsLoader,
  ontologyKeyOf,
} from '../../src/domain/plan/ontology-facts.js';

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function definition(
  scenario: string,
  behaviors: OntologyDefinition['behaviors'],
  functions: OntologyDefinition['functions'] = [],
): OntologyDefinition {
  return {
    filePath: path.join(scenario, 'ontology-1', 'ontology.yaml'),
    ontologyId: '1',
    ontologyName: '采购单',
    scenarioId: scenario,
    scenarioName: scenario,
    behaviors,
    functions,
    concepts: [],
    relations: [],
  };
}

function indexOf(...definitions: OntologyDefinition[]): OntologyIndex {
  return { byId: new Map(), all: definitions, warnings: [] };
}

describe('ontologyKeyOf', () => {
  it('取「场景目录/本体目录」作为闸门口径键', () => {
    expect(ontologyKeyOf(definition('scenario-a', []))).toBe('scenario-a/ontology-1');
  });
});

describe('buildOntologyFacts', () => {
  const PURCHASE = definition(
    'scenario-a',
    [
      { name: 'QueryPurchaseRecords', title: '查采购单', description: '', opType: 'query', concept: 'PurchaseRecord' },
      { name: 'CreatePurchaseRecord', title: '建采购单', description: '', opType: 'command', concept: 'PurchaseRecord' },
    ],
    [{ name: 'sumRawNotArrivalQty', title: '未到位数量', description: '', relatedConcepts: ['PurchaseRecord'] }],
  );

  it('函数 → 关联概念；行为 → 同本体 query 行为', () => {
    const facts = buildOntologyFacts(indexOf(PURCHASE));
    expect(facts.relatedConceptsOf('sumRawNotArrivalQty')).toEqual(['PurchaseRecord']);
    expect(facts.ontologyKeysOfFunction('sumRawNotArrivalQty')).toEqual(['scenario-a/ontology-1']);
    expect(facts.queryBehaviorsOf('PurchaseRecord', 'scenario-a/ontology-1')).toEqual(['QueryPurchaseRecords']);
  });

  it('command 行为不进取数集合', () => {
    const facts = buildOntologyFacts(indexOf(PURCHASE));
    expect(facts.queryBehaviorsOf('PurchaseRecord')).not.toContain('CreatePurchaseRecord');
  });

  it('未声明的概念 / 函数 → 空数组（不抛）', () => {
    const facts = buildOntologyFacts(indexOf(PURCHASE));
    expect(facts.relatedConceptsOf('unknown_fn')).toEqual([]);
    expect(facts.queryBehaviorsOf('UnknownConcept')).toEqual([]);
  });

  it('同名跨本体按名合并：概念与本体键都并集', () => {
    const other = definition(
      'scenario-b',
      [
        { name: 'QueryPurchaseRecordList', title: '查列表', description: '', opType: 'query', concept: 'PurchaseRecord' },
      ],
      [{ name: 'sumRawNotArrivalQty', title: '未到位数量', description: '', relatedConcepts: ['PurchaseOrder'] }],
    );
    const facts = buildOntologyFacts(indexOf(PURCHASE, other));

    expect(facts.relatedConceptsOf('sumRawNotArrivalQty')).toEqual(['PurchaseRecord', 'PurchaseOrder']);
    expect(facts.ontologyKeysOfFunction('sumRawNotArrivalQty')).toEqual([
      'scenario-a/ontology-1',
      'scenario-b/ontology-1',
    ]);
    // 本体键对不上时回退全量（同名即同一工具）
    expect(facts.queryBehaviorsOf('PurchaseRecord', 'scenario-c/ontology-9')).toEqual([
      'QueryPurchaseRecords',
      'QueryPurchaseRecordList',
    ]);
  });
});

describe('createOntologyFactsLoader', () => {
  function tmpAgentDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-plan-facts-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('签名不变时复用同一份缓存', () => {
    const agentDir = tmpAgentDir();
    const loader = createOntologyFactsLoader(agentDir);
    const first = loader.get();
    expect(loader.get()).toBe(first);
    expect(loader.getIndex()).toBe(loader.getIndex());
  });

  it('目录签名变化后重新加载', () => {
    const agentDir = tmpAgentDir();
    const loader = createOntologyFactsLoader(agentDir);
    const before = loader.get();
    expect(before.relatedConceptsOf('sumRawNotArrivalQty')).toEqual([]);

    const dir = path.join(agentDir, 'ontology', '场景A', '采购单');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'ontology.yaml'),
      [
        'metadata:',
        '  ontology_id: "1"',
        '  ontology_name: 采购单',
        'behaviors:',
        '  - name: QueryStock',
        '    op_type: query',
        'functions:',
        '  - name: sumRawNotArrivalQty',
        '    related_concepts:',
        '      - PurchaseRecord',
      ].join('\n'),
      'utf8',
    );

    const after = loader.get();
    expect(after).not.toBe(before);
    expect(loader.getIndex().all).toHaveLength(1);
  });
});
