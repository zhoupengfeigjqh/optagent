/**
 * 集成测试（进程内，021 / 2026-11-24）：**command 写后失效**与行为类型收敛。
 *
 * 这一层证明的是包装器 + 闸门 + 记录三者合成后的真实行为：
 * 1. 上一次 command 用过的函数结果，不能给下一个 command 复用——必须重算；
 * 2. `query` 行为不判规则、不失效（即使本体里给它写了前置规则）；
 * 3. command 无前置规则时，执行后**仍然**失效（它改了数据）；
 * 4. `op_type` 非法 / 同名冲突 / 未声明却被规则绑定 → fatal：零执行 + 立即收尾。
 *
 * 装配口径与生产一致：`ruleGateTools` 在最内层，020 权限闸门在外层（本用例不涉及权限）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createRuleGate } from '../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';
import { readToolError } from '../../src/domain/tool-error.js';
import { createToolSuspension } from '../../src/domain/tool-suspension.js';
import { ruleGateTools } from '../../src/infra/tool-rule-gate.js';

const dirs: string[] = [];

function writeOntology(agentDir: string, ontology: string, yaml: string): void {
  const dir = path.join(agentDir, 'ontology', '原材料采购和库存', ontology);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), yaml, 'utf8');
}

/** 一条绑定 `behavior` 的前置规则（条件恒为 `checkSupplierExistence.pass == true`） */
function ruleLines(name: string, behavior: string): string[] {
  return [
    `  - name: ${name}`,
    `    behavior: ${behavior}`,
    '    position: 前置',
    '    related_functions: [checkSupplierExistence]',
    '    rule_design:',
    '      groups:',
    '        - conditions:',
    '            - { function: checkSupplierExistence, field: pass, operator: eq, values: ["true"] }',
  ];
}

function fixture(): string {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-cmd-'));
  dirs.push(agentDir);

  writeOntology(agentDir, '采购单', [
    'metadata:',
    '  scenario_name: 原材料采购和库存',
    '  ontology_name: 采购单',
    'behaviors:',
    '  - name: CreatePurchaseRecord',
    '    op_type: command',
    '  - name: CancelPurchaseRecord',
    '    op_type: command',
    // 无前置规则：执行后仍必须失效
    '  - name: ClosePurchaseRecord',
    '    op_type: command',
    // 挂了规则也会被忽略（query 没有前置规则）
    '  - name: QueryPurchaseRecords',
    '    op_type: query',
    // op_type 缺失 → 非法行为（fatal）
    '  - name: BrokenBehavior',
    // 与第二个本体的 query 冲突 → 非法行为（fatal）
    '  - name: SyncInventory',
    '    op_type: command',
    'functions:',
    '  - name: checkSupplierExistence',
    '    type: query',
    '    response: { pass: boolean }',
    'rules:',
    ...ruleLines('采购-供应商存在', 'CreatePurchaseRecord'),
    ...ruleLines('撤销-供应商存在', 'CancelPurchaseRecord'),
    ...ruleLines('查询-供应商存在', 'QueryPurchaseRecords'),
    ...ruleLines('幽灵-供应商存在', 'UndeclaredBehavior'),
  ].join('\n'));

  writeOntology(agentDir, '库存', [
    'metadata:',
    '  scenario_name: 原材料采购和库存',
    '  ontology_name: 库存',
    'behaviors:',
    '  - name: SyncInventory',
    '    op_type: query',
  ].join('\n'));

  return agentDir;
}

interface Harness {
  call(name: string): Promise<'ok' | 'error'>;
  record: ReturnType<typeof createFunctionRecord>;
  suspension: ReturnType<typeof createToolSuspension>;
  ended: { count: number };
  impl: Record<string, ReturnType<typeof vi.fn>>;
}

function harness(): Harness {
  const agentDir = fixture();
  const record = createFunctionRecord();
  const ended = { count: 0 };
  const suspension = createToolSuspension(() => {
    ended.count += 1;
  });

  const payload = (body: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify(body) }],
    details: {},
  });
  const impl: Record<string, ReturnType<typeof vi.fn>> = {
    check: vi.fn(async () => payload({ pass: true })),
    create: vi.fn(async () => payload({ created: true })),
    cancel: vi.fn(async () => payload({ cancelled: true })),
    close: vi.fn(async () => payload({ closed: true })),
    query: vi.fn(async () => payload([])),
    broken: vi.fn(async () => payload({})),
    ghost: vi.fn(async () => payload({})),
    sync: vi.fn(async () => payload({})),
  };

  const tools: AgentTool[] = [
    ['erp__checkSupplierExistence', 'check'],
    ['erp__CreatePurchaseRecord', 'create'],
    ['erp__CancelPurchaseRecord', 'cancel'],
    ['erp__ClosePurchaseRecord', 'close'],
    ['erp__QueryPurchaseRecords', 'query'],
    ['erp__BrokenBehavior', 'broken'],
    ['erp__UndeclaredBehavior', 'ghost'],
    ['erp__SyncInventory', 'sync'],
  ].map(([name, key]) => ({
    name: name as string,
    label: 'x',
    description: 'x',
    parameters: {} as never,
    execute: impl[key as string] as never,
  }));

  const wrapped = ruleGateTools(tools, {
    gate: createRuleGate({ agentDir }),
    record,
    builtinNames: new Set<string>(),
    availableNames: new Set(tools.map((tool) => tool.name)),
    suspension,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    userId: 'admin',
    agentName: '采购助手',
    threadId: 't_1',
  });

  return {
    record,
    suspension,
    ended,
    impl,
    async call(name: string) {
      const tool = wrapped.find((item) => item.name === name);
      if (tool === undefined) throw new Error(`unknown tool: ${name}`);
      const result = await tool.execute('call', {});
      return readToolError(result.details) === undefined ? 'ok' : 'error';
    },
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('command 写后失效', () => {
  it('上一个 command 用过的函数不能给下一个 command 复用：先暂停，重算后通过', async () => {
    const h = harness();

    expect(await h.call('erp__checkSupplierExistence')).toBe('ok');  // 世代 0
    expect(await h.call('erp__CreatePurchaseRecord')).toBe('ok');     // 用世代 0 → 世代 1
    expect(h.record.epoch).toBe(1);
    expect(h.record.has('checkSupplierExistence')).toBe(false);
    expect(h.record.hasEver('checkSupplierExistence')).toBe(true);

    // 不重算直接撤销：结果已过期 → 暂停，行为零执行
    expect(await h.call('erp__CancelPurchaseRecord')).toBe('error');
    expect(h.impl.cancel).toHaveBeenCalledTimes(0);

    // 重算后通过
    expect(await h.call('erp__checkSupplierExistence')).toBe('ok');
    expect(await h.call('erp__CancelPurchaseRecord')).toBe('ok');
    expect(h.impl.cancel).toHaveBeenCalledTimes(1);
    expect(h.record.epoch).toBe(2);
  });

  it('command 无前置规则也会失效：改了数据就要重算', async () => {
    const h = harness();

    expect(await h.call('erp__checkSupplierExistence')).toBe('ok');
    expect(await h.call('erp__ClosePurchaseRecord')).toBe('ok');      // 无规则，但仍是写操作
    expect(h.record.epoch).toBe(1);
    expect(h.record.has('checkSupplierExistence')).toBe(false);
  });
});

describe('query 不受影响', () => {
  it('query 挂了前置规则也直接执行，且不推进世代', async () => {
    const h = harness();

    expect(await h.call('erp__checkSupplierExistence')).toBe('ok');
    expect(await h.call('erp__CreatePurchaseRecord')).toBe('ok');     // 世代 1
    // 记录里的 check 已过期；若 query 也按世代过滤，这里会被暂停
    expect(await h.call('erp__QueryPurchaseRecords')).toBe('ok');
    expect(h.impl.query).toHaveBeenCalledTimes(1);
    expect(h.record.epoch).toBe(1);
  });
});

describe('非法本体行为：致命错误，立即结束本轮', () => {
  it('op_type 非法：行为零执行，收尾恰好触发 1 次', async () => {
    const h = harness();

    expect(await h.call('erp__BrokenBehavior')).toBe('error');
    expect(h.impl.broken).toHaveBeenCalledTimes(0);
    expect(h.suspension.suspended).toBe(true);
    expect(h.suspension.exhausted).toBe(true);
    expect(h.ended.count).toBe(1);
  });

  it('未声明却被规则绑定：行为零执行，立即收尾', async () => {
    const h = harness();

    expect(await h.call('erp__UndeclaredBehavior')).toBe('error');
    expect(h.impl.ghost).toHaveBeenCalledTimes(0);
    expect(h.record.has('UndeclaredBehavior')).toBe(false);
    expect(h.ended.count).toBe(1);
  });

  it('多本体同名行为 op_type 冲突：行为零执行，立即收尾', async () => {
    const h = harness();

    expect(await h.call('erp__SyncInventory')).toBe('error');
    expect(h.impl.sync).toHaveBeenCalledTimes(0);
    expect(h.record.has('SyncInventory')).toBe(false);
    expect(h.ended.count).toBe(1);
  });
});
