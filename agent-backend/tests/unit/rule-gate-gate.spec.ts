/**
 * 单元测试：闸门判定合成（021）——`prepare` 五种结局与注册校验。
 *
 * 守住的口径（`FR-013` / `FR-041` / `FR-044` / 2026-11-24 增补）：
 * - 判定顺序固定：
 *   `非法行为(fatal) → 识别 → 非行为(function) → query(直接执行) → 无前置规则
 *    → 缺函数 → 注册校验 → 暂停/阻断 → 求值`；
 * - 缺函数但**全部已注册** → `pause`（可自愈）；存在未注册 → `deny(unregistered)`；
 * - 服务里存在但被白名单过滤 = 未注册；
 * - 求值 `false` → `deny(condition_false)`；结构非法 → `deny(config_unavailable)`；
 * - `null` 记录不触发暂停/注册校验，但其条件全不成立；
 * - **command 写后失效**：上一次 command 之前的函数结果 → `pause` 且点名"已过期"；
 * - **query 不判规则**：挂了规则也直接 `{ kind: 'behavior' }`；
 * - 非法行为（`op_type` 坏 / 冲突 / 未声明）→ `fatal`，先于其他分支；
 * - 端口**永不抛**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchKeys } from '../../src/domain/ontology-doc.js';
import { createRuleGate } from '../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';
import type { FunctionRecord, RuleGatePort } from '../../src/domain/rule-gate/types.js';

const tmpDirs: string[] = [];

function tmpAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-rule-gate-gate-'));
  tmpDirs.push(dir);
  return dir;
}

function writeOntology(agentDir: string, yaml: string, ontology = '采购单'): void {
  const dir = path.join(agentDir, 'ontology', '原材料采购和库存', ontology);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), yaml, 'utf8');
}

/** 标准本体：一个命令（有前置规则）、一个查询（无规则）+ 两个函数声明 */
function baseYaml(extraRules: string[] = [], extraFunctions: string[] = []): string {
  return [
    'metadata:',
    '  scenario_name: 原材料采购和库存',
    '  ontology_name: 采购单',
    'behaviors:',
    '  - name: CreatePurchaseRecord',
    '    title: 创建采购单',
    '    op_type: command',
    '  - name: QueryStock',
    '    title: 查询库存',
    '    op_type: query',
    'functions:',
    '  - name: checkSupplierExistence',
    '    type: query',
    '    response:',
    '      pass: boolean',
    '  - name: inferPurchasePurpose',
    '    type: query',
    '    response:',
    '      purpose: string',
    ...extraFunctions,
    'rules:',
    '  - name: 采购-供应商名称一致',
    '    title: 供应商必须已存在',
    '    behavior: CreatePurchaseRecord',
    '    position: 前置',
    '    related_functions:',
    '      - checkSupplierExistence',
    '    rule_design:',
    '      combine: and',
    '      groups:',
    '        - combine: and',
    '          conditions:',
    '            - function: checkSupplierExistence',
    '              field: pass',
    '              operator: eq',
    '              values: ["true"]',
    '    fail_message: 供应商名称不存在，禁止创建采购单',
    ...extraRules,
  ].join('\n');
}

function gateFor(agentDir: string): { gate: RuleGatePort; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn<(warnings: string[]) => void>();
  const gate = createRuleGate({ agentDir, warn });
  return { gate, warn };
}

function availableOf(...names: string[]): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of names) {
    for (const key of matchKeys(name)) set.add(key);
  }
  return set;
}

function recordWith(pairs: Array<[string, unknown]> = []): FunctionRecord {
  const record = createFunctionRecord();
  for (const [name, value] of pairs) record.add(name, value);
  return record;
}

const CREATE = 'erp__CreatePurchaseRecord';
const CHECK = 'erp__checkSupplierExistence';
const ALL_AVAILABLE = availableOf(CREATE, CHECK, 'erp__inferPurchasePurpose', 'erp__QueryStock');

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('prepare：识别与五种结局', () => {
  it('非本体行为 → function', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    expect(gate.prepare({ toolName: 'erp__SomethingElse', record: recordWith(), available: ALL_AVAILABLE }))
      .toEqual({ kind: 'function' });
  });

  it('query 行为：即使挂了规则也直接执行（不暂停、不拒绝、不带 command 标记）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      baseYaml([
        '  - name: 查询-供应商存在',
        '    behavior: QueryStock',
        '    position: 前置',
        '    related_functions:',
        '      - checkSupplierExistence',
        '    rule_design:',
        '      groups:',
        '        - conditions:',
        '            - function: checkSupplierExistence',
        '              field: pass',
        '              operator: eq',
        '              values: ["true"]',
      ]),
    );
    const { gate } = gateFor(agent);

    // 记录为空也直接放行：query 的规则被忽略
    expect(gate.prepare({ toolName: 'erp__QueryStock', record: recordWith(), available: ALL_AVAILABLE }))
      .toEqual({ kind: 'behavior' });
  });

  it('command 无前置规则 → behavior(command)（执行后仍会失效记录）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      [
        'behaviors:',
        '  - name: CancelPurchaseRecord',
        '    op_type: command',
        'rules: []',
      ].join('\n'),
    );
    const { gate } = gateFor(agent);

    expect(
      gate.prepare({
        toolName: 'erp__CancelPurchaseRecord',
        record: recordWith(),
        available: ALL_AVAILABLE,
      }),
    ).toEqual({ kind: 'behavior', command: true });
  });

  it('缺函数但全部已注册 → pause（含规则名、缺失函数与"请先执行"）', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const result = gate.prepare({ toolName: CREATE, record: recordWith(), available: ALL_AVAILABLE });
    expect(result.kind).toBe('pause');
    if (result.kind !== 'pause') return;
    expect(result.message).toContain('采购-供应商名称一致');
    expect(result.message).toContain('缺失函数：checkSupplierExistence');
    expect(result.message).toContain('请先执行');
    expect(result.details[2]).toContain('缺失函数：checkSupplierExistence');
    expect(result.diagnosis?.missingFunctions).toEqual(['checkSupplierExistence']);
    expect(result.diagnosis?.staleFunctions).toBeUndefined();
  });

  it('函数在上一次 command 之前执行过 → pause 且点名"已过期"，不误报"未注册"', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const record = recordWith([[CHECK, { pass: true }]]);
    record.invalidate();

    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result.kind).toBe('pause');
    if (result.kind !== 'pause') return;
    expect(result.message).toContain('已过期函数：checkSupplierExistence');
    expect(result.message).toContain('必须重新计算');
    expect(result.details.join('\n')).toContain('已过期函数：checkSupplierExistence');
    expect(result.diagnosis?.staleFunctions).toEqual(['checkSupplierExistence']);
    expect(result.diagnosis?.missingFunctions).toBeUndefined();
  });

  it('缺函数且未注册 → deny(unregistered)，不进入暂停', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const result = gate.prepare({
      toolName: CREATE,
      record: recordWith(),
      available: availableOf(CREATE),
    });
    expect(result).toMatchObject({ kind: 'deny', reason: 'unregistered' });
    if (result.kind !== 'deny') return;
    expect(result.details.join('\n')).toContain('未注册函数：checkSupplierExistence');
    expect(result.message).toContain('未注册函数');
  });

  it('服务里存在但被白名单过滤（未挂载）→ 视为未注册', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const result = gate.prepare({
      toolName: CREATE,
      record: recordWith(),
      available: availableOf(CREATE, 'erp__otherFunction'),
    });
    expect(result).toMatchObject({ kind: 'deny', reason: 'unregistered' });
  });

  it('函数齐备且求值 true → behavior(command)', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const record = recordWith([[CHECK, { success: true, data: { pass: true } }]]);
    expect(gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE })).toEqual({
      kind: 'behavior',
      command: true,
    });
  });

  it('函数齐备且求值 false → deny(condition_false)，带 fail_message', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const record = recordWith([[CHECK, { success: true, data: { pass: false } }]]);
    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result).toMatchObject({ kind: 'deny', reason: 'condition_false' });
    if (result.kind !== 'deny') return;
    expect(result.details).toContain('结论：供应商名称不存在，禁止创建采购单');
    expect(result.details.some((line) => line.startsWith('未成立条件：checkSupplierExistence.pass')))
      .toBe(true);
  });

  it('记录值为 null（函数执行失败）→ 不暂停、不阻断，按求值不成立拒绝', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);

    const record = recordWith([[CHECK, null]]);
    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result).toMatchObject({ kind: 'deny', reason: 'condition_false' });
  });

  it('rule_design 非对象 → deny(config_unavailable)（fail-closed）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      baseYaml(['  - name: 坏规则', '    behavior: CreatePurchaseRecord', '    position: 前置', '    rule_design: "oops"']),
    );
    const { gate } = gateFor(agent);

    const record = recordWith([[CHECK, { pass: true }]]);
    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result).toMatchObject({ kind: 'deny', reason: 'config_unavailable' });
    if (result.kind !== 'deny') return;
    expect(result.details.join('\n')).toContain('规则配置不可用');
  });

  it('前置规则缺 rule_design → 不阻断（behavior）并告警一次', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      baseYaml([
        '  - name: 无设计规则',
        '    behavior: CreatePurchaseRecord',
        '    position: 前置',
        '    related_functions: []',
      ]),
    );
    const { gate, warn } = gateFor(agent);

    // 另一条前置规则所需函数已执行且成立，只剩"无设计规则"这一条不确定因素
    const record = recordWith([[CHECK, { pass: true }]]);
    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result).toEqual({ kind: 'behavior', command: true });
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]![0].join('\n')).toContain('rule_without_design');

    gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('公共函数未在本体 functions[] 声明 → 按未声明类型求值并告警（不拒绝）', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      baseYaml([
        '  - name: 公共函数规则',
        '    behavior: CreatePurchaseRecord',
        '    position: 前置',
        '    related_functions:',
        '      - publicCheck',
        '    rule_design:',
        '      groups:',
        '        - conditions:',
        '            - function: publicCheck',
        '              field: pass',
        '              operator: eq',
        '              values: ["true"]',
      ]),
    );
    const { gate, warn } = gateFor(agent);

    const record = recordWith([
      [CHECK, { pass: true }],
      ['publicCheck', { pass: 'true' }],
    ]);
    const result = gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE });
    expect(result).toEqual({ kind: 'behavior', command: true });
    expect(warn.mock.calls.flatMap((call) => call[0] as string[]).join('\n')).toContain(
      'publiccheck:function_not_declared',
    );
  });

  it('端口永不抛：非法 agentDir → deny(config_unavailable)', () => {
    const gate = createRuleGate({ agentDir: undefined as never });
    const input = { toolName: CREATE, record: recordWith(), available: ALL_AVAILABLE };

    expect(() => gate.prepare(input)).not.toThrow();
    expect(gate.prepare(input)).toMatchObject({ kind: 'deny', reason: 'config_unavailable' });
  });

  it('invalidate() 后按新配置重载', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, baseYaml());
    const { gate } = gateFor(agent);
    const record = recordWith([[CHECK, { pass: false }]]);

    expect(gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE })).toMatchObject({
      reason: 'condition_false',
    });

    // 目录签名不变（只改文件内容）→ 仍用旧快照
    const dir = path.join(agent, 'ontology', '原材料采购和库存', '采购单');
    fs.writeFileSync(path.join(dir, 'ontology.yaml'), baseYaml().replace('position: 前置', 'position: 前置'), 'utf8');
    expect(gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE })).toMatchObject({
      reason: 'condition_false',
    });

    gate.invalidate();
    expect(gate.prepare({ toolName: CREATE, record, available: ALL_AVAILABLE })).toBeDefined();
  });
});

describe('prepare：非法本体行为（fatal，先于一切分支）', () => {
  it('op_type 缺失 → fatal(bad_op_type)，行为不被当作函数', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      ['behaviors:', '  - name: CreatePurchaseRecord', 'rules: []'].join('\n'),
    );
    const { gate } = gateFor(agent);

    const result = gate.prepare({ toolName: CREATE, record: recordWith(), available: ALL_AVAILABLE });
    expect(result).toMatchObject({ kind: 'fatal', cause: 'bad_op_type', reason: 'config_unavailable' });
    if (result.kind !== 'fatal') return;
    expect(result.message).toContain('op_type');
    expect(result.details.join('\n')).toContain('修正为 command 或 query');
  });

  it('op_type 为其它值（write）→ fatal(bad_op_type)', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, ['behaviors:', '  - name: CreatePurchaseRecord', '    op_type: write'].join('\n'));
    const { gate } = gateFor(agent);

    expect(
      gate.prepare({ toolName: CREATE, record: recordWith(), available: ALL_AVAILABLE }),
    ).toMatchObject({ kind: 'fatal', cause: 'bad_op_type' });
  });

  it('多本体同名行为 query/command 混用 → fatal(op_type_conflict)，文案点名双方', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      ['behaviors:', '  - name: SyncInventory', '    op_type: command', 'rules: []'].join('\n'),
      '采购单',
    );
    writeOntology(
      agent,
      ['behaviors:', '  - name: SyncInventory', '    op_type: query'].join('\n'),
      '库存',
    );
    const { gate } = gateFor(agent);

    const result = gate.prepare({
      toolName: 'erp__SyncInventory',
      record: recordWith(),
      available: ALL_AVAILABLE,
    });
    expect(result).toMatchObject({ kind: 'fatal', cause: 'op_type_conflict' });
    if (result.kind !== 'fatal') return;
    expect(result.details.join('\n')).toContain('op_type 不一致');
    expect(result.details.join('\n')).toContain('command');
    expect(result.details.join('\n')).toContain('query');
  });

  it('被规则绑定但未声明 → fatal(undeclared)', () => {
    const agent = tmpAgentDir();
    writeOntology(
      agent,
      ['behaviors:', '  - name: QueryStock', '    op_type: query', 'rules:', '  - name: 幽灵', '    behavior: GhostBehavior', '    position: 前置', '    related_functions: []'].join('\n'),
    );
    const { gate } = gateFor(agent);

    const result = gate.prepare({
      toolName: 'erp__GhostBehavior',
      record: recordWith(),
      available: ALL_AVAILABLE,
    });
    expect(result).toMatchObject({ kind: 'fatal', cause: 'undeclared' });
    if (result.kind !== 'fatal') return;
    expect(result.details.join('\n')).toContain('未在 behaviors[] 中声明');
  });

  it('fatal 优先于缺函数：不进入 pause、不查注册', () => {
    const agent = tmpAgentDir();
    writeOntology(agent, ['behaviors:', '  - name: CreatePurchaseRecord', '    op_type: weird'].join('\n'));
    const { gate } = gateFor(agent);

    // available 为空也不该变成 unregistered
    const result = gate.prepare({ toolName: CREATE, record: recordWith(), available: new Set() });
    expect(result.kind).toBe('fatal');
  });
});
