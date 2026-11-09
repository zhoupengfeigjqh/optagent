/**
 * 单元测试：`ontology.yaml` 的统一解析与名称归一（020/021 共用）。
 *
 * 守住的口径：
 * - 三段（`metadata` / `behaviors` / `rules` / `functions`）的解析与缺省；
 * - 坏数据只告警不抛：空 `name` 丢弃、非数组降级、缺 `response` 提示；
 * - 告警片段与 020 既有口径逐字一致（`<文件路径>:<片段>`）；
 * - 名称归一与匹配键只此一处（`matchKeys` = 完整名 + 去前缀名）；
 * - 目录签名：缺失为 `missing`，写入后为时间戳。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  loadOntologyDocs,
  matchKeys,
  normalizeName,
  ontologySignature,
  parseOntologyDoc,
  stripServicePrefix,
} from '../../src/domain/ontology-doc.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-ontology-doc-'));
  tmpDirs.push(dir);
  return dir;
}

/** 写一份本体（返回本体目录）；`yaml` 为原文，便于构造坏数据 */
function writeOntology(agentDir: string, yaml: string, ontology = '原材料采购和库存'): string {
  const dir = path.join(agentDir, 'ontology', '生产调度', ontology);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), yaml, 'utf8');
  return dir;
}

/** 符号链接在部分 Windows 环境需要管理员权限：探测一次，不可用时跳过该用例 */
function canCreateSymlink(): boolean {
  const base = tmpAgentDir();
  try {
    fs.symlinkSync(path.join(base, 'target'), path.join(base, 'link'), 'junction');
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('normalizeName / stripServicePrefix / matchKeys', () => {
  it('归一：去首尾空白 + 小写', () => {
    expect(normalizeName('  CheckSupplier  ')).toBe('checksupplier');
    expect(normalizeName('')).toBe('');
  });

  it('去首个 __ 前缀，保留原大小写；无前缀时原样返回', () => {
    expect(stripServicePrefix('erp__checkSupplierExistence')).toBe('checkSupplierExistence');
    expect(stripServicePrefix('checkSupplierExistence')).toBe('checkSupplierExistence');
    expect(stripServicePrefix('a__b__c')).toBe('b__c');
  });

  it('匹配键：完整名 + 去前缀名；空名为空数组', () => {
    expect(matchKeys('erp__CreatePurchaseRecord')).toEqual([
      'erp__createpurchaserecord',
      'createpurchaserecord',
    ]);
    expect(matchKeys('CreatePurchaseRecord')).toEqual(['createpurchaserecord']);
    expect(matchKeys('   ')).toEqual([]);
  });
});

describe('parseOntologyDoc', () => {
  it('三段齐备：metadata 展示名、behaviors、rules 原样、functions 的 response/type', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc(
      {
        metadata: { scenario_name: '生产调度', ontology_name: '原材料采购和库存' },
        behaviors: [{ name: 'CreatePurchaseRecord', title: '创建采购单', op_type: 'command' }],
        rules: [{ name: 'R1' }, 'raw-entry'],
        functions: [
          { name: 'checkSupplierExistence', type: 'query', response: { pass: 'boolean' } },
        ],
      },
      warnings,
      '生产调度/原材料采购和库存',
    );

    expect(doc.key).toBe('生产调度/原材料采购和库存');
    expect(doc.scenarioName).toBe('生产调度');
    expect(doc.ontologyName).toBe('原材料采购和库存');
    expect(doc.behaviors).toEqual([
      { name: 'CreatePurchaseRecord', title: '创建采购单', opType: 'command' },
    ]);
    expect(doc.rules).toHaveLength(2);
    expect(doc.functions).toEqual([
      { name: 'checkSupplierExistence', type: 'query', response: { pass: 'boolean' } },
    ]);
    expect(warnings).toEqual([]);
  });

  it('metadata 缺失：展示名回退目录名，行为/函数缺省字段取空串', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc(
      { behaviors: [{ name: 'B1' }], functions: [{ name: 'f1', response: {} }] },
      warnings,
      '场景A/本体B',
    );

    expect(doc.scenarioName).toBe('场景A');
    expect(doc.ontologyName).toBe('本体B');
    expect(doc.behaviors[0]).toEqual({ name: 'B1', title: '', opType: '' });
    expect(doc.functions[0]).toEqual({ name: 'f1', type: '', response: {} });
    expect(warnings).toEqual([]);
  });

  it('behaviors 空名丢弃、同名去重：两处都告警', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc(
      { behaviors: [{ name: 'B1' }, { name: '  ' }, { name: 'b1' }, { title: '无名字' }] },
      warnings,
      'S/O',
    );

    expect(doc.behaviors).toHaveLength(1);
    expect(warnings.join('\n')).toContain('behavior_missing_name');
    expect(warnings.join('\n')).toContain('behavior_duplicated:b1');
  });

  it('behaviors / rules / functions 非数组：各自降级为空并告警', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc(
      { behaviors: 'oops', rules: { name: 'R1' }, functions: 42 },
      warnings,
      'S/O',
    );

    expect(doc.behaviors).toEqual([]);
    expect(doc.rules).toEqual([]);
    expect(doc.functions).toEqual([]);
    expect(warnings.join('\n')).toContain('behaviors_not_array');
    expect(warnings.join('\n')).toContain('rules_not_array');
    expect(warnings.join('\n')).toContain('functions_not_array');
  });

  it('functions 缺 response 告警（仍保留，类型按未声明处理）；缺 name 丢弃', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc(
      { functions: [{ name: 'f1' }, { type: 'query' }, { name: 'f2', response: null }] },
      warnings,
      'S/O',
    );

    expect(doc.functions.map((f) => f.name)).toEqual(['f1', 'f2']);
    expect(doc.functions[0]!.response).toBeUndefined();
    expect(warnings.join('\n')).toContain('function_missing_response:f1');
    expect(warnings.join('\n')).toContain('function_missing_name');
  });

  it('空对象：三段皆空且零告警', () => {
    const warnings: string[] = [];
    const doc = parseOntologyDoc({}, warnings, 'S/O');
    expect(doc.behaviors).toEqual([]);
    expect(doc.rules).toEqual([]);
    expect(doc.functions).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('告警前缀用传入的 source（默认回退 key）', () => {
    const warnings: string[] = [];
    parseOntologyDoc({ behaviors: [{}] }, warnings, 'S/O', '/abs/ontology.yaml');
    expect(warnings[0]).toBe('/abs/ontology.yaml:behavior_missing_name');
  });
});

describe('loadOntologyDocs', () => {
  it('中文路径：枚举并解析出 key 与三段', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      [
        'behaviors:',
        '  - name: CreatePurchaseRecord',
        '    title: 创建采购单',
        '    op_type: command',
        'functions:',
        '  - name: checkSupplierExistence',
        '    type: query',
        '    response:',
        '      pass: boolean',
      ].join('\n'),
    );

    const warnings: string[] = [];
    const docs = loadOntologyDocs(agent, warnings);

    expect(docs).toHaveLength(1);
    expect(docs[0]!.key).toBe('生产调度/原材料采购和库存');
    expect(docs[0]!.behaviors[0]!.name).toBe('CreatePurchaseRecord');
    expect(docs[0]!.functions[0]!.response).toEqual({ pass: 'boolean' });
    expect(warnings).toEqual([]);
  });

  it('坏 YAML 的本体跳过（不抛、不中断其它本体）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, 'behaviors: [\n', '坏本体');
    writeOntology(agent, 'behaviors:\n  - name: B1\n', '好本体');

    const warnings: string[] = [];
    const docs = loadOntologyDocs(agent, warnings);

    expect(docs.map((d) => d.key)).toEqual(['生产调度/好本体']);
    expect(warnings.join('\n')).toContain('invalid_yaml');
  });

  it('无 ontology 目录：空数组且零告警', () => {
    const agent = tmpAgentDir();
    const warnings: string[] = [];
    expect(loadOntologyDocs(agent, warnings)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.skipIf(!canCreateSymlink())('符号链接目录跳过：不读取、不告警为坏数据', () => {
    const agent = tmpAgentDir();
    const outside = tmpAgentDir();
    writeOntology(outside, 'behaviors:\n  - name: Escaped\n');
    fs.mkdirSync(path.join(agent, 'ontology', '生产调度'), { recursive: true });
    fs.symlinkSync(
      path.join(outside, 'ontology', '生产调度', '原材料采购和库存'),
      path.join(agent, 'ontology', '生产调度', '链接本体'),
      'junction',
    );

    const warnings: string[] = [];
    expect(loadOntologyDocs(agent, warnings)).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('目录签名：无 ontology 目录为 missing，写入后变为时间戳', () => {
    const agent = tmpAgentDir();
    expect(ontologySignature(agent)).toBe('missing');
    writeOntology(agent, 'behaviors: []\n');
    expect(ontologySignature(agent)).toMatch(/^\d/);
  });
});
