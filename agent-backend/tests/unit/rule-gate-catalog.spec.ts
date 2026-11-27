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

function behaviorLines(name: string, opType = 'command'): string[] {
  return [`  - name: ${name}`, `    title: ${name}`, `    op_type: ${opType}`];
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadGateCatalog', () => {
  it('command 只装载前置规则；后置静默跳过（不告警），按行为归一索引，保持文件内顺序', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        ...behaviorLines('CreatePurchaseRecord'),
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
    expect(bucket!.command).toBe(true);
    expect(bucket!.pre.map((r) => r.name)).toEqual(['R-前置-1', 'R-前置-2']);
    expect(bucket!.pre[0]).toMatchObject({
      behavior: 'CreatePurchaseRecord',
      position: '前置',
      relatedFunctions: ['checkSupplierExistence'],
      title: '供应商必须已存在',
    });
    expect(bucket!.pre[0]!.design!.groups).toHaveLength(1);
  });

  it('后置规则在行为解析之前跳过：不登记行为、不判未声明、零告警', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        ...behaviorLines('QueryStock', 'query'),
        'rules:',
        ...ruleLines({ name: 'R-后置', behavior: 'CreatePurchaseRecord', position: '后置' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);

    expect(snapshot.warnings).toEqual([]);
    expect(snapshot.behaviorIndex.has('createpurchaserecord')).toBe(false);
    expect(snapshot.invalidBehaviors.size).toBe(0);
  });

  it('behavior 空 / position 非法 → 整条忽略并告警', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        ...behaviorLines('CreatePurchaseRecord'),
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

  it('多本体同名行为（同为 command）→ 规则合并，顺序按本体键升序', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'A本体',
      ['behaviors:', ...behaviorLines('CreatePurchaseRecord'), 'rules:', ...ruleLines({ name: '来自A' })].join('\n'),
    );
    writeOntology(
      agent,
      'B本体',
      ['behaviors:', ...behaviorLines('CreatePurchaseRecord'), 'rules:', ...ruleLines({ name: '来自B' })].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    expect(snapshot.behaviorIndex.get('createpurchaserecord')!.pre.map((r) => r.name)).toEqual([
      '来自A',
      '来自B',
    ]);
    expect(snapshot.invalidBehaviors.size).toBe(0);
  });

  it('query 行为：规则静默忽略（pre 为空、无告警），行为仍被识别', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        ...behaviorLines('QueryPurchaseRecords', 'query'),
        'rules:',
        ...ruleLines({ name: '查询-供应商存在', behavior: 'QueryPurchaseRecords' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    const bucket = snapshot.behaviorIndex.get('querypurchaserecords');

    expect(bucket).toBeDefined();
    expect(bucket!.command).toBe(false);
    expect(bucket!.pre).toEqual([]);
    expect(snapshot.warnings).toEqual([]);
  });

  it('op_type 大小写与空白归一（" Command " → command）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        '  - name: CreatePurchaseRecord',
        '    op_type: "  Command  "',
        'rules:',
        ...ruleLines({ name: 'R1' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    expect(snapshot.behaviorIndex.get('createpurchaserecord')!.command).toBe(true);
    expect(snapshot.invalidBehaviors.size).toBe(0);
  });

  it('op_type 缺失 / 其它值 → 非法行为（bad_op_type），不装载规则', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      [
        'behaviors:',
        '  - name: BrokenBehavior',
        '  - name: WeirdBehavior',
        '    op_type: write',
        'rules:',
        ...ruleLines({ name: 'R-缺类型', behavior: 'BrokenBehavior' }),
      ].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);

    expect(snapshot.behaviorIndex.size).toBe(0);
    expect(snapshot.invalidBehaviors.get('brokenbehavior')).toMatchObject({ reason: 'bad_op_type' });
    expect(snapshot.invalidBehaviors.get('weirdbehavior')).toMatchObject({ reason: 'bad_op_type' });
    expect(snapshot.warnings.join('\n')).toContain('behavior_bad_op_type:BrokenBehavior');
    expect(snapshot.warnings.join('\n')).toContain('behavior_bad_op_type:WeirdBehavior');
  });

  it('多本体同名行为 op_type 冲突（query vs command）→ 非法（op_type_conflict），点名来源', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      'A本体',
      ['behaviors:', ...behaviorLines('SyncInventory', 'command'), 'rules:', ...ruleLines({ name: '来自A', behavior: 'SyncInventory' })].join('\n'),
    );
    writeOntology(agent, 'B本体', ['behaviors:', ...behaviorLines('SyncInventory', 'query')].join('\n'));

    const snapshot = loadGateCatalog(agent);
    const invalid = snapshot.invalidBehaviors.get('syncinventory');

    expect(snapshot.behaviorIndex.has('syncinventory')).toBe(false);
    expect(invalid).toMatchObject({ reason: 'op_type_conflict' });
    expect(invalid!.sources.map((source) => source.opType).sort()).toEqual(['command', 'query']);
    expect(snapshot.warnings.join('\n')).toContain('behavior_op_type_conflict:SyncInventory');
  });

  it('被规则绑定但未在 behaviors[] 声明 → 非法（undeclared），不建桶', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      '采购单',
      ['behaviors:', ...behaviorLines('QueryStock', 'query'), 'rules:', ...ruleLines({ name: '幽灵规则' })].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);

    expect(snapshot.behaviorIndex.has('createpurchaserecord')).toBe(false);
    expect(snapshot.invalidBehaviors.get('createpurchaserecord')).toMatchObject({
      reason: 'undeclared',
    });
    expect(snapshot.warnings.join('\n')).toContain('behavior_undeclared:CreatePurchaseRecord');
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
    writeOntology(
      agent,
      '采购单',
      ['behaviors:', ...behaviorLines('CreatePurchaseRecord'), 'rules:', ...ruleLines({ design: false })].join('\n'),
    );

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
      [
        'behaviors:',
        ...behaviorLines('CreatePurchaseRecord'),
        'rules:',
        ...ruleLines({ design: false }),
        '    rule_design: "oops"',
      ].join('\n'),
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
        'behaviors:',
        ...behaviorLines('CreatePurchaseRecord'),
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
    writeOntology(
      agent,
      '好本体',
      ['behaviors:', ...behaviorLines('CreatePurchaseRecord'), 'rules:', ...ruleLines({ name: '好规则' })].join('\n'),
    );

    const snapshot = loadGateCatalog(agent);
    expect([...snapshot.behaviorIndex.keys()]).toEqual(['createpurchaserecord']);
    expect(snapshot.warnings.join('\n')).toContain('invalid_yaml');
  });

  it('空目录 / 无 ontology：空索引、零告警、签名 missing', () => {
    const agent = tmpAgentDir();
    const snapshot = loadGateCatalog(agent);
    expect(snapshot.behaviorIndex.size).toBe(0);
    expect(snapshot.invalidBehaviors.size).toBe(0);
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
        'behaviors:',
        ...behaviorLines('CreatePurchaseRecord'),
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
