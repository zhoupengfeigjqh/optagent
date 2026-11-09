/**
 * 单元测试：规则视图加载（021）。
 *
 * 守住的口径：
 * - 规则只认 `position: 前置 / 后置`，`behavior` 空或 `position` 非法 → 整条忽略 + 告警；
 * - 按行为归一索引，同一行为的规则保持文件内顺序；
 * - 多本体同名行为 → 规则合并（按本体键升序，顺序可复现）；
 * - `functions[].response` 建索引（归一函数名）；
 * - `rule_design` 缺失 → `design=null` 且**不算**非法；非对象 → `designInvalid`（fail-closed）；
 * - 坏文件不抛、不中断其他本体。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { catalogSignature, loadGateCatalog } from '../../src/domain/rule-gate/catalog.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-rule-gate-'));
  tmpDirs.push(dir);
  return dir;
}

function writeOntology(agentDir: string, ontology: string, yaml: string): void {
  const dir = path.join(agentDir, 'ontology', '生产调度', ontology);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), yaml, 'utf8');
}

/** 一条最小的前置规则（可替换 behavior / 名称 / 位置） */
function ruleLines(options: {
  name?: string;
  behavior?: string;
  position?: string;
  design?: boolean;
  functions?: string[];
}): string[] {
  const lines = [
    `  - name: ${options.name ?? '采购-供应商名称一致'}`,
    '    title: 供应商必须已存在',
    `    behavior: ${options.behavior ?? 'CreatePurchaseRecord'}`,
    `    position: ${options.position ?? '前置'}`,
    '    related_functions:',
  ];
  for (const fn of options.functions ?? ['checkSupplierExistence']) {
    lines.push(`      - ${fn}`);
  }
  if (options.design !== false) {
    lines.push(
      '    rule_design:',
      '      combine: and',
      '      groups:',
      '        - combine: and',
      '          conditions:',
      '            - function: checkSupplierExistence',
      '              field: pass',
      '              operator: eq',
      '              values: ["true"]',
    );
  }
  return lines;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadGateCatalog', () => {
  it('前置 / 后置分桶，按行为归一索引，保持文件内顺序', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        '  - name: CreatePurchaseRecord',
        '    title: 创建采购单',
        'functions:',
        '  - name: checkSupplierExistence',
        '    type: query',
        '    response:',
        '      pass: boolean',
        'rules:',
        ...ruleLines({ name: 'R-前置-1' }),
        ...ruleLines({ name: 'R-前置-2', position: '前置' }),
        ...ruleLines({ name: 'R-后置', position: '后置' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    const bucket = snapshot.behaviorIndex.get('createpurchaserecord');

    expect(snapshot.warnings).toEqual([]);
    expect(bucket!.pre.map((r) => r.name)).toEqual(['R-前置-1', 'R-前置-2']);
    expect(bucket!.post.map((r) => r.name)).toEqual(['R-后置']);
    expect(bucket!.pre[0]).toMatchObject({
      behavior: 'CreatePurchaseRecord',
      position: '前置',
      relatedFunctions: ['checkSupplierExistence'],
      title: '供应商必须已存在',
    });
    expect(bucket!.pre[0]!.design!.groups).toHaveLength(1);
  });

  it('behavior 空 / position 非法 → 整条忽略并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'rules:',
        ...ruleLines({ name: '缺行为', behavior: '  ' }),
        ...ruleLines({ name: '坏位置', position: '执行前' }),
        ...ruleLines({ name: '正常' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    const bucket = snapshot.behaviorIndex.get('createpurchaserecord');

    expect(bucket!.pre.map((r) => r.name)).toEqual(['正常']);
    expect(snapshot.warnings.join('\n')).toContain('rule_missing_behavior');
    expect(snapshot.warnings.join('\n')).toContain('rule_bad_position:执行前');
  });

  it('多本体同名行为 → 规则合并，顺序按本体键升序', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, 'A本体', ['rules:', ...ruleLines({ name: '来自A' })].join('\n'));
    writeOntology(agent, 'B本体', ['rules:', ...ruleLines({ name: '来自B' })].join('\n'));

    const snapshot = loadGateCatalog(agent);
    expect(snapshot.behaviorIndex.get('createpurchaserecord')!.pre.map((r) => r.name)).toEqual([
      '来自A',
      '来自B',
    ]);
  });

  it('functions[].response 建索引：键为归一函数名', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'functions:',
        '  - name: CheckSupplierExistence',
        '    type: query',
        '    response:',
        '      pass: boolean',
        '  - name: inferPurchasePurpose',
        '    type: query',
        '    response:',
        '      purpose: string',
        'rules: []',
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    expect(snapshot.functionResponses.get('checksupplierexistence')).toEqual({ pass: 'boolean' });
    expect(snapshot.functionResponses.get('inferpurchasepurpose')).toEqual({ purpose: 'string' });
  });

  it('rule_design 缺失 → design=null 且不算非法（不阻断，FR-022）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '采购单', ['rules:', ...ruleLines({ design: false })].join('\n'));

    const snapshot = loadGateCatalog(agent);
    const rule = snapshot.behaviorIndex.get('createpurchaserecord')!.pre[0]!;
    expect(rule.design).toBeNull();
    expect(rule.designInvalid).toBeUndefined();
  });

  it('rule_design 非对象 → designInvalid（fail-closed）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      ['rules:', ...ruleLines({ design: false }), '    rule_design: "oops"'].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    const rule = snapshot.behaviorIndex.get('createpurchaserecord')!.pre[0]!;
    expect(rule.design).toBeNull();
    expect(rule.designInvalid).toBe(true);
    expect(snapshot.warnings).toContain('rule_design_not_object');
  });

  it('related_functions / data_supplements 非数组或含非字符串 → 降级并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'rules:',
        '  - name: R1',
        '    behavior: CreatePurchaseRecord',
        '    position: 前置',
        '    related_functions: checkSupplierExistence',
        '    data_supplements:',
        '      - 近三个月采购',
        '      - 42',
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    const rule = snapshot.behaviorIndex.get('createpurchaserecord')!.pre[0]!;
    expect(rule.relatedFunctions).toEqual([]);
    expect(rule.dataSupplements).toEqual(['近三个月采购']);
    expect(snapshot.warnings.join('\n')).toContain('related_functions_not_array');
  });

  it('坏 ontology.yaml 不抛、不中断其他本体', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, '坏本体', 'rules: [\n');
    writeOntology(agent, '好本体', ['rules:', ...ruleLines({ name: '好规则' })].join('\n'));

    const snapshot = loadGateCatalog(agent);
    expect([...snapshot.behaviorIndex.keys()]).toEqual(['createpurchaserecord']);
    expect(snapshot.warnings.join('\n')).toContain('invalid_yaml');
  });

  it('空目录 / 无 ontology：空索引、零告警、签名 missing', () => {
    const agent = tmpAgentDir();
    const snapshot = loadGateCatalog(agent);
    expect(snapshot.behaviorIndex.size).toBe(0);
    expect(snapshot.functionResponses.size).toBe(0);
    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.signature).toBe('missing');
    expect(catalogSignature(agent)).toBe('missing');
  });

  it('pass_message / fail_message 顶层优先，缺省取 design 内的', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'rules:',
        '  - name: R1',
        '    behavior: CreatePurchaseRecord',
        '    position: 前置',
        '    pass_message: 顶层通过',
        '    rule_design:',
        '      fail_message: 设计内失败',
        '      groups:',
        '        - conditions:',
        '            - function: f',
        '              field: x',
        '              operator: eq',
        '              values: ["1"]',
      ].join('\n'),
    );

    const rule = loadGateCatalog(agent).behaviorIndex.get('createpurchaserecord')!.pre[0]!;
    expect(rule.passMessage).toBe('顶层通过');
    expect(rule.failMessage).toBe('设计内失败');
  });

  it('签名可外部传入（省一次 stat）', () => {
    const agent = tmpAgentDir();
    expect(loadGateCatalog(agent, 'sig-1').signature).toBe('sig-1');
  });
});
