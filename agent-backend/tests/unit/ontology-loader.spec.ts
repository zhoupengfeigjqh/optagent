/**
 * 单元测试：本体加载与索引（016）。
 *
 * 守住的边界：
 * - 只提取 metadata / functions / behaviors / rules（concepts 等字段不进入模型）；
 * - `title` 缺失回退 `name`；`data_supplements` 缺失 / 空 / 非数组 → 空数组；
 * - `rules[].behavior` 空白的规则被丢弃；坏 YAML 只告警；
 * - 同一 `ontology_id` 的多个文件全部保留（同 ID 多本体）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadOntologyIndex } from '../../src/domain/ontology-focus/ontology-loader.js';

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
  '  - name: noTitleFunction',
  'behaviors:',
  '  - name: CreatePurchaseRecord',
  '    title: 创建原材料采购单',
  '    op_type: command',
  '  - name: QueryPurchaseRecords',
  '    title: 查询原材料采购单信息',
  '    op_type: query',
  'rules:',
  '  - name: V01',
  '    behavior: CreatePurchaseRecord',
  '    data_supplements:',
  '      - QueryPurchaseRecords',
  '      - "  "',
  '      - 42',
  '  - name: invalid',
  '    behavior: ""',
  'concepts:',
  '  - name: 不应被建模',
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
    expect(ontology.functions).toEqual([
      { name: 'checkRawMaterialUnit', title: '校验采购原材料单位一致性' },
      { name: 'noTitleFunction', title: 'noTitleFunction' },
    ]);
    expect(ontology.behaviors).toEqual([
      { name: 'CreatePurchaseRecord', title: '创建原材料采购单', opType: 'command' },
      { name: 'QueryPurchaseRecords', title: '查询原材料采购单信息', opType: 'query' },
    ]);
    // 空白的行为名让规则被丢弃；非字符串 / 空白补充项被过滤
    expect(ontology.rules).toEqual([
      { behavior: 'CreatePurchaseRecord', dataSupplements: ['QueryPurchaseRecords'] },
    ]);
    expect(index.byId.get('1')).toHaveLength(1);
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

  it('data_supplements 缺失 / 空数组 / 非数组都收敛为空数组', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'S',
      'O',
      [
        'metadata:',
        '  ontology_id: 3',
        'behaviors:',
        '  - name: A',
        'rules:',
        '  - { behavior: A }',
        '  - { behavior: A, data_supplements: [] }',
        '  - { behavior: A, data_supplements: QueryB }',
      ].join('\n'),
    );
    const index = loadOntologyIndex(agent);
    expect(index.all[0]!.rules.map((rule) => rule.dataSupplements)).toEqual([[], [], []]);
  });

  it('functions / behaviors 非数组只告警并返回空', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'S',
      'O',
      'metadata:\n  ontology_id: 4\nfunctions: x\nbehaviors: y\nrules: z\n',
    );
    const index = loadOntologyIndex(agent);
    expect(index.all[0]!.functions).toEqual([]);
    expect(index.all[0]!.behaviors).toEqual([]);
    expect(index.all[0]!.rules).toEqual([]);
    expect(index.warnings.length).toBeGreaterThanOrEqual(3);
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
