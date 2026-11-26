import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOntologyIndex } from '../../src/domain/intent-focus/ontology-loader.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-ontology-'));
  tmpDirs.push(dir);
  return dir;
}

function writeOntology(
  agentDir: string,
  scenario: string,
  ontology: string,
  yamlText: string,
): string {
  const dir = path.join(agentDir, 'ontology', scenario, ontology);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ontology.yaml');
  fs.writeFileSync(file, yamlText, 'utf8');
  return file;
}

const VALID = [
  'metadata:',
  '  ontology_id: 1',
  '  ontology_name: 原材料采购和库存',
  '  scenario_id: 2',
  '  scenario_name: 生产调度',
  'functions:',
  '  - name: checkRawMaterialUnit',
  '    title: 校验采购原材料单位一致性',
  'behaviors:',
  '  - name: CreatePurchaseRecord',
  '    title: 创建原材料采购单',
  '    description: 创建一笔新的原材料采购记录。',
  '    op_type: command',
  '    concept: PurchaseRecord',
  '  - name: QueryPurchaseRecords',
  '    title: 查询原材料采购单信息',
  '    op_type: query',
  '    concept: PurchaseRecord',
  '  - name: NoTitleBehavior',
  'rules:',
  '  - name: V01',
  '    behavior: CreatePurchaseRecord',
  '    data_supplements:',
  '      - QueryPurchaseRecords',
  'concepts:',
  '  - name: PurchaseRecord',
  '    title: 原材料采购记录',
  '  - name: RawMaterial',
  'relations:',
  '  - name: RecordsRawMaterial',
  '    title: 记录原材料',
  '    source: PurchaseRecord',
  '    target: RawMaterial',
  '    cardinality: N:1',
  '    relation_type: Functional',
  '  - name: NoTitleRelation',
  '    source: PurchaseRecord',
  '    target: RawMaterial',
].join('\n');

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadOntologyIndex', () => {
  it('提取所需字段并按 ontology_id 建索引', () => {
    const agent = tmpAgentDir();
    const file = writeOntology(agent, '生产调度', '原材料采购和库存', VALID);
    const index = loadOntologyIndex(agent);

    expect(index.all).toHaveLength(1);
    const ontology = index.all[0]!;
    expect(ontology.filePath).toBe(file);
    expect(ontology.ontologyId).toBe('1');
    expect(ontology.ontologyName).toBe('原材料采购和库存');
    expect(ontology.behaviors).toEqual([
      {
        name: 'CreatePurchaseRecord',
        title: '创建原材料采购单',
        description: '创建一笔新的原材料采购记录。',
        opType: 'command',
        concept: 'PurchaseRecord',
      },
      // description 缺失 → 空串（题面构造时再降级到 title）
      {
        name: 'QueryPurchaseRecords',
        title: '查询原材料采购单信息',
        description: '',
        opType: 'query',
        concept: 'PurchaseRecord',
      },
      { name: 'NoTitleBehavior', title: 'NoTitleBehavior', description: '', opType: null, concept: null },
    ]);
    expect(ontology.concepts).toEqual([
      { name: 'PurchaseRecord', title: '原材料采购记录' },
      { name: 'RawMaterial', title: 'RawMaterial' },
    ]);
    expect(ontology.relations).toEqual([
      {
        name: 'RecordsRawMaterial',
        source: 'PurchaseRecord',
        target: 'RawMaterial',
        // 2026-11-13：五元组要展示关系语义，title 必须读进来
        title: '记录原材料',
        relationType: ['Functional'],
        cardinality: 'N:1',
      },
      {
        name: 'NoTitleRelation',
        source: 'PurchaseRecord',
        target: 'RawMaterial',
        title: 'NoTitleRelation',
        relationType: [],
        cardinality: null,
      },
    ]);
    expect(index.byId.get('1')).toHaveLength(1);
  });

  it('functions 只解析四字段（params / response 不进模型）；rules 不解析；无告警', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '生产调度',
      '原材料采购和库存',
      [
        'metadata:',
        '  ontology_id: 1',
        'functions:',
        '  - name: checkRawMaterialUnit',
        '    title: 校验采购原材料单位一致性',
        '  - name: sumRawNotArrivalQty',
        '    title: 原材料未到位数',
        '    description: 汇总未到位数量',
        '    related_concepts:',
        '      - PurchaseRecord',
        '    params:',
        '      - name: purchase',
        '    response:',
        '      type: number',
        'behaviors:',
        '  - name: QueryPurchaseRecords',
        '    title: 查询原材料采购单信息',
        '    op_type: query',
        '    concept: PurchaseRecord',
        'rules:',
        '  - name: V01',
        '    behavior: QueryPurchaseRecords',
      ].join('\n'),
    );
    const index = loadOntologyIndex(agent);
    const ontology = index.all[0]!;

    expect(ontology.functions).toEqual([
      {
        name: 'checkRawMaterialUnit',
        title: '校验采购原材料单位一致性',
        description: '',
        relatedConcepts: [],
      },
      {
        name: 'sumRawNotArrivalQty',
        title: '原材料未到位数',
        description: '汇总未到位数量',
        relatedConcepts: ['PurchaseRecord'],
      },
    ]);
    expect(ontology).not.toHaveProperty('rules');
    expect(JSON.stringify(ontology)).not.toContain('params');
    expect(index.warnings).toEqual([]);
  });

  it('函数缺 name 被丢弃并告警；related_concepts 坏形状按空数组处理', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'S',
      'O',
      [
        'metadata:',
        '  ontology_id: 9',
        'functions:',
        '  - title: 没有名字',
        '  - name: ok',
        '    related_concepts: 42',
      ].join('\n'),
    );
    const index = loadOntologyIndex(agent);

    expect(index.all[0]!.functions).toEqual([
      { name: 'ok', title: 'ok', description: '', relatedConcepts: [] },
    ]);
    expect(index.warnings.some((warning) => warning.endsWith(':function_missing_name'))).toBe(true);
  });

  it('关系缺端点被丢弃并告警；relation_type 支持单值与数组两种写法', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'S',
      'O',
      [
        'metadata:',
        '  ontology_id: 8',
        'concepts:',
        '  - name: A',
        '  - name: B',
        'relations:',
        '  - name: Half',
        '    source: A',
        '  - name: Pair',
        '    source: A',
        '    target: B',
        '    relation_type:',
        '      - Functional',
        '      - InverseFunctional',
      ].join('\n'),
    );

    const index = loadOntologyIndex(agent);
    const relations = index.all[0]!.relations;
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      name: 'Pair',
      relationType: ['Functional', 'InverseFunctional'],
      cardinality: null,
    });
    expect(index.warnings.some((warning) => warning.includes('relation_missing_endpoint'))).toBe(true);
  });

  it('同一 ontology_id 的多个文件全部保留', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '生产调度', '本体A', 'metadata:\n  ontology_id: 1\n  ontology_name: A\n');
    writeOntology(agent, '生产调度', '本体B', 'metadata:\n  ontology_id: "1"\n  ontology_name: B\n');
    const index = loadOntologyIndex(agent);
    expect(index.byId.get('1')).toHaveLength(2);
    expect(index.all.map((item) => item.ontologyName)).toEqual(['A', 'B']);
  });

  it('缺 ontology_id 的文件被跳过并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '生产调度', '坏本体', 'metadata:\n  ontology_name: X\n');
    const index = loadOntologyIndex(agent);
    expect(index.all).toEqual([]);
    expect(index.warnings[0]).toMatch(/missing_ontology_id/);
  });

  it('坏 YAML 只告警，不影响其他本体', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '生产调度', '坏', 'metadata: [unclosed\n');
    writeOntology(agent, '生产调度', '好', 'metadata:\n  ontology_id: 9\n');
    const index = loadOntologyIndex(agent);
    expect(index.all.map((item) => item.ontologyId)).toEqual(['9']);
    expect(index.warnings.some((warning) => warning.includes('invalid_yaml'))).toBe(true);
  });

  it('空名的行为被丢弃，behaviors 非数组只告警并返回空', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'S',
      'O',
      [
        'metadata:',
        '  ontology_id: 4',
        'behaviors:',
        '  - name: ""',
        '  - title: 只有标题',
      ].join('\n'),
    );
    writeOntology(agent, 'S', 'P', 'metadata:\n  ontology_id: 5\nbehaviors: x\n');

    const index = loadOntologyIndex(agent);
    expect(index.all[0]!.behaviors).toEqual([]);
    expect(index.all[1]!.behaviors).toEqual([]);
    expect(index.warnings.some((warning) => warning.includes('behavior_missing_name'))).toBe(true);
    expect(index.warnings.some((warning) => warning.includes('behaviors_not_array'))).toBe(true);
  });

  it('符号链接目录被跳过', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, 'S', 'Real', 'metadata:\n  ontology_id: 5\n');
    try {
      fs.symlinkSync(
        path.join(agent, 'ontology', 'S', 'Real'),
        path.join(agent, 'ontology', 'S', 'Link'),
        'junction',
      );
    } catch {
      return;
    }
    expect(loadOntologyIndex(agent).all).toHaveLength(1);
  });

  it('中文路径可加载；目录不存在返回空索引', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '生产调度', '原材料采购和库存', 'metadata:\n  ontology_id: 6\n');
    expect(loadOntologyIndex(agent).all).toHaveLength(1);
    expect(loadOntologyIndex(path.join(agent, 'missing'))).toEqual({
      byId: new Map(),
      all: [],
      warnings: [],
    });
  });
});
