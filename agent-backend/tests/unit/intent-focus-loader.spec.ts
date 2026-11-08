/**
 * 单元测试：本体加载与索引（016）。
 *
 * 守住的边界：
 * - 只提取 metadata / behaviors（concepts / functions / rules 等字段**不进入模型**）；
 * - `title` 缺失回退 `name`；`description` 缺失为空串（是否降级由题面构造裁决）；
 * - 坏 YAML 只告警；
 * - 同一 `ontology_id` 的多个文件全部保留（同 ID 多本体）。
 *
 * 2026-11-06：能力聚焦只到行为，`functions` / `rules` 不再解析。
 */
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
  '  - name: QueryPurchaseRecords',
  '    title: 查询原材料采购单信息',
  '    op_type: query',
  '  - name: NoTitleBehavior',
  'rules:',
  '  - name: V01',
  '    behavior: CreatePurchaseRecord',
  '    data_supplements:',
  '      - QueryPurchaseRecords',
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
    expect(ontology.behaviors).toEqual([
      {
        name: 'CreatePurchaseRecord',
        title: '创建原材料采购单',
        description: '创建一笔新的原材料采购记录。',
        opType: 'command',
      },
      // description 缺失 → 空串（题面构造时再降级到 title）
      { name: 'QueryPurchaseRecords', title: '查询原材料采购单信息', description: '', opType: 'query' },
      // title 缺失 → 回退 name
      { name: 'NoTitleBehavior', title: 'NoTitleBehavior', description: '', opType: null },
    ]);
    expect(index.byId.get('1')).toHaveLength(1);
  });

  it('functions / rules 不再解析：字段不存在且不产生告警', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '生产调度', '原材料采购和库存', VALID);
    const index = loadOntologyIndex(agent);
    const ontology = index.all[0]!;

    expect(ontology).not.toHaveProperty('functions');
    expect(ontology).not.toHaveProperty('rules');
    // `functions` / `rules` / `concepts` 都是合法 YAML，不应触发任何告警
    expect(index.warnings).toEqual([]);
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
