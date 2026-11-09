/**
 * 集成测试（进程内，021）：规则闸门 → 真实 pi loop → SSE 状态口径。
 *
 * 为什么必须有这一层：包装器的单测只能证明"返回了什么"，证明不了
 * 1. 暂停的失败标记真的被 pi 翻成 `tool_call_end.status='error'`（卡片标红）；
 * 2. 暂停后**记录不被清空**：补调一次函数后重试即可通过（`FR-008`）；
 * 3. 拒绝后是**软收尾**（2026-11-09）：本轮其余工具不执行，模型拿到终局指令后
 *    总结并正常 `done`，**不产生 error 失败轮**；模型固执重试时兜底纯中止一次；
 * 4. 注册校验失败时**不进入暂停**、不给模型空转补调的机会（`FR-044`）。
 *
 * 装配顺序按生产口径：`guardTools(ruleGateTools(tools))`（020 外、021 内），
 * 且两个闸门共享**同一份**本轮挂起状态。
 */
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { EventStream } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchKeys } from '../../src/domain/ontology-doc.js';
import { RULE_TERMINAL_NOTICE } from '../../src/domain/rule-gate/format.js';
import { createRuleGate } from '../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';
import { createScopeGuard } from '../../src/domain/scope-guard/index.js';
import { SUSPENDED_MESSAGE, createToolSuspension } from '../../src/domain/tool-suspension.js';
import type { LlmEvent } from '../../src/types.js';
import { runAgentLoopEvents } from '../../src/infra/agent-loop.js';
import { ruleGateTools } from '../../src/infra/tool-rule-gate.js';
import { guardTools } from '../../src/infra/tool-scope-guard.js';

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const CREATE = 'erp__CreatePurchaseRecord';
const CHECK = 'erp__checkSupplierExistence';
const STOCK = 'erp__checkStock';
const PURPOSE = 'erp__inferPurchasePurpose';

const ontologyDirs: string[] = [];

function fixtureAgentDir(): string {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-rule-gate-loop-'));
  ontologyDirs.push(agentDir);

  const dir = path.join(agentDir, 'ontology', '原材料采购和库存', '采购单');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ontology.yaml'),
    [
      'metadata:',
      '  scenario_name: 原材料采购和库存',
      '  ontology_name: 采购单',
      'behaviors:',
      '  - name: CreatePurchaseRecord',
      '    title: 创建采购单',
      'functions:',
      '  - name: checkSupplierExistence',
      '    type: query',
      '    response:',
      '      pass: boolean',
      '  - name: checkStock',
      '    type: query',
      '    response:',
      '      pass: boolean',
      '  - name: inferPurchasePurpose',
      '    type: query',
      '    response:',
      '      purpose: string',
      'rules:',
      '  - name: 采购-供应商名称一致',
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
      '  - name: 采购-库存充足',
      '    behavior: CreatePurchaseRecord',
      '    position: 前置',
      '    related_functions:',
      '      - checkStock',
      '    rule_design:',
      '      groups:',
      '        - conditions:',
      '            - function: checkStock',
      '              field: pass',
      '              operator: eq',
      '              values: ["true"]',
      '    fail_message: 库存不足，禁止创建采购单',
      '  - name: 采购目的推理',
      '    behavior: CreatePurchaseRecord',
      '    position: 后置',
      '    related_functions:',
      '      - inferPurchasePurpose',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(dir, 'securities.yaml'),
    [
      'securities:',
      '  - action_name: CreatePurchaseRecord',
      '    scope: [admin]',
      '  - action_name: checkSupplierExistence',
      '    scope: [admin]',
      '  - action_name: checkStock',
      '    scope: [admin]',
      '  - action_name: inferPurchasePurpose',
      '    scope: [admin]',
    ].join('\n'),
    'utf8',
  );
  return agentDir;
}

function assistant(content: unknown[], stopReason: 'toolUse' | 'stop'): AssistantMessage {
  return { role: 'assistant', content, stopReason, usage: USAGE, timestamp: Date.now() } as never;
}

function toolStep(id: string, name: string): AssistantMessage {
  return assistant([{ type: 'toolCall', id, name, arguments: {} }], 'toolUse');
}

function stopStep(): AssistantMessage {
  return assistant([{ type: 'text', text: '好的' }], 'stop');
}

function fakeStream(message: AssistantMessage) {
  const stream = new EventStream(
    (event: { type: string }) => event.type === 'done' || event.type === 'error',
    (event: { type: string; message?: unknown; error?: unknown }) =>
      event.type === 'done' ? event.message : event.error,
  );
  queueMicrotask(() => {
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: message.stopReason, message });
  });
  return stream as never;
}

interface Harness {
  events: LlmEvent[];
  /** 模型调用次数 */
  hops: number;
  checkCalls: number;
  stockCalls: number;
  createCalls: number;
  /** 兜底出口（纯中止）触发次数：单轮内最多 1 次 */
  stops: number;
  /** 共享挂起状态 */
  suspended: () => boolean;
}

async function runScript(options: {
  steps: AssistantMessage[];
  pass?: boolean;
  stockPass?: boolean;
  available?: string[];
}): Promise<Harness> {
  const agentDir = fixtureAgentDir();
  const scopeGuard = createScopeGuard({ agentDir, username: 'admin' });
  const gate = createRuleGate({ agentDir });
  const controller = new AbortController();
  const record = createFunctionRecord();

  const harness: Harness = {
    events: [],
    hops: 0,
    checkCalls: 0,
    stockCalls: 0,
    createCalls: 0,
    stops: 0,
    suspended: () => suspension.suspended,
  };

  // 生产口径：两个闸门共享同一份挂起状态；兜底出口接到"纯中止本轮"
  const suspension = createToolSuspension(() => {
    harness.stops += 1;
    controller.abort();
  });

  const json = (body: Record<string, unknown>) => ({
    content: [{ type: 'text', text: JSON.stringify(body) }],
    details: {},
  });

  const checkExecute = vi.fn(async () => json({ pass: options.pass ?? true }));
  const stockExecute = vi.fn(async () => json({ pass: options.stockPass ?? true }));
  const createExecute = vi.fn(async () => ({
    content: [{ type: 'text', text: '采购单已创建' }],
    details: {},
  }));
  const purposeExecute = vi.fn(async () => json({ purpose: '补货' }));

  const tools: AgentTool[] = [
    { name: CHECK, label: '校验供应商', description: 'x', parameters: {} as never, execute: checkExecute as never },
    { name: STOCK, label: '校验库存', description: 'x', parameters: {} as never, execute: stockExecute as never },
    { name: CREATE, label: '创建采购单', description: 'x', parameters: {} as never, execute: createExecute as never },
    { name: PURPOSE, label: '推导用途', description: 'x', parameters: {} as never, execute: purposeExecute as never },
  ];

  const availableNames = new Set<string>();
  for (const name of options.available ?? tools.map((tool) => tool.name)) {
    for (const key of matchKeys(name)) availableNames.add(key);
  }

  const ruled = ruleGateTools(tools, {
    gate,
    record,
    builtinNames: new Set<string>(),
    availableNames,
    suspension,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
    userId: 'admin',
    agentName: '采购助手',
    threadId: 't_1',
  });

  const wrapped = guardTools(
    ruled,
    scopeGuard,
    {
      logger: { warn: vi.fn(), error: vi.fn() } as never,
      userId: 'admin',
      agentName: '采购助手',
      threadId: 't_1',
    },
    suspension,
  );

  const streamFn = (() => {
    harness.hops += 1;
    const message = options.steps[Math.min(harness.hops - 1, options.steps.length - 1)]!;
    return fakeStream(message);
  }) as never;

  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn,
    systemPrompt: 'test',
    messages: [{ role: 'user', content: '创建一笔采购单' }],
    tools: wrapped,
    thinking: false,
    signal: controller.signal,
  })) {
    harness.events.push(event);
  }

  harness.checkCalls = checkExecute.mock.calls.length;
  harness.stockCalls = stockExecute.mock.calls.length;
  harness.createCalls = createExecute.mock.calls.length;
  return harness;
}

function toolEnds(events: LlmEvent[]) {
  return events.filter((event) => event.type === 'tool_call_end') as Array<{
    callId: string;
    status: string;
    resultText?: string;
  }>;
}

function hasErrorEvent(events: LlmEvent[]): boolean {
  return events.some((event) => event.type === 'error');
}

afterEach(() => {
  for (const dir of ontologyDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('暂停 → 补调 → 通过（含 FR-008 记录不清空）', () => {
  it('直接调行为先暂停；补调两个函数后重试成功，并追加后置提示', async () => {
    // 先执行 check（进记录）→ 调行为缺 checkStock → 暂停 → 补调 checkStock → 重试成功。
    // 若暂停清空了记录，第 4 跳会再次因为缺 check 暂停 —— 因此"成功"本身就是 FR-008 的证据。
    const harness = await runScript({
      steps: [
        toolStep('c1', CHECK),
        toolStep('c2', CREATE),
        toolStep('c3', STOCK),
        toolStep('c4', CREATE),
        stopStep(),
      ],
    });

    const ends = toolEnds(harness.events);
    expect(ends.map((end) => end.status)).toEqual(['success', 'error', 'success', 'success']);

    // 暂停：业务工具零执行，正文含规则名、缺失函数与规则全文
    expect(harness.createCalls).toBe(1);
    expect(ends[1]!.resultText).toContain('前置规则所需函数尚未执行');
    expect(ends[1]!.resultText).toContain('采购-库存充足');
    expect(ends[1]!.resultText).toContain('缺失函数：checkStock');
    expect(ends[1]!.resultText).toContain('—— 规则全文 ——');

    // 暂停不挂起：整轮正常结束
    expect(harness.suspended()).toBe(false);
    expect(harness.stops).toBe(0);

    // 补调后重试通过：后置提示追加在原结果之后（不覆盖）
    expect(ends[3]!.resultText).toContain('采购单已创建');
    expect(ends[3]!.resultText).toContain('后置规则提示');
    expect(ends[3]!.resultText).toContain('采购目的推理');
  });
});

describe('求值不成立 → 软收尾（2026-11-09）', () => {
  it('拒绝并挂起本轮、业务工具零执行；模型总结后正常 done，不产生 error 轮', async () => {
    const harness = await runScript({
      steps: [toolStep('c1', CHECK), toolStep('c2', STOCK), toolStep('c3', CREATE), stopStep()],
      pass: false,
    });

    const ends = toolEnds(harness.events);
    expect(ends.map((end) => end.status)).toEqual(['success', 'success', 'error']);
    expect(harness.createCalls).toBe(0);
    expect(harness.suspended()).toBe(true);
    expect(harness.stops).toBe(0);

    // 卡片 = 结论 + 明细 + 终局指令
    expect(ends[2]!.resultText).toContain('未通过前置规则校验');
    expect(ends[2]!.resultText).toContain('供应商名称不存在，禁止创建采购单');
    expect(ends[2]!.resultText).toContain(RULE_TERMINAL_NOTICE);

    // 软收尾：模型拿到结果后**又发起一次调用**（hop 4 = stop）并以 done 结束——没有 error 事件
    expect(hasErrorEvent(harness.events)).toBe(false);
    expect(harness.hops).toBe(4);
    expect(harness.events.some((event) => event.type === 'done')).toBe(true);
  });
});

describe('后置未注册 → 已执行后阻断（FR-042）', () => {
  it('业务结果完整保留、追加阻断说明与终局指令、挂起本轮，本轮正常 done', async () => {
    const harness = await runScript({
      steps: [toolStep('c1', CHECK), toolStep('c2', STOCK), toolStep('c3', CREATE), stopStep()],
      available: [CHECK, STOCK, CREATE],
    });

    const ends = toolEnds(harness.events);
    // 行为确实执行成功：卡片仍是成功态，不改成失败
    expect(ends.map((end) => end.status)).toEqual(['success', 'success', 'success']);
    expect(harness.createCalls).toBe(1);
    expect(harness.suspended()).toBe(true);

    // 业务正文在、后置规则提示不在；阻断说明与终局指令追加在后
    expect(ends[2]!.resultText).toContain('采购单已创建');
    expect(ends[2]!.resultText).not.toContain('后置规则提示');
    expect(ends[2]!.resultText).toContain('已执行成功');
    expect(ends[2]!.resultText).toContain('业务数据已写入');
    expect(ends[2]!.resultText).toContain('未注册函数：inferPurchasePurpose');
    expect(ends[2]!.resultText).toContain(RULE_TERMINAL_NOTICE);

    expect(hasErrorEvent(harness.events)).toBe(false);
    expect(harness.events.some((event) => event.type === 'done')).toBe(true);
  });
});

describe('跨轮：记录不继承（FR-001 / SC-003）', () => {
  it('上一轮执行过函数，新一轮仍要求重新执行', async () => {
    const first = await runScript({ steps: [toolStep('c1', CHECK), stopStep()] });
    expect(first.checkCalls).toBe(1);
    expect(toolEnds(first.events)[0]!.status).toBe('success');

    const second = await runScript({ steps: [toolStep('c1', CREATE), stopStep()] });
    const ends = toolEnds(second.events);
    expect(ends[0]!.status).toBe('error');
    expect(ends[0]!.resultText).toContain('前置规则所需函数尚未执行');
    expect(second.createCalls).toBe(0);
  });
});

describe('注册校验失败 → 挂起本轮（软收尾）', () => {
  it('函数未挂载给模型：不进入暂停、业务工具零执行，后续工具被 020 拦下', async () => {
    const harness = await runScript({
      steps: [toolStep('c1', CREATE), toolStep('c2', CHECK), stopStep()],
      available: [CREATE],
    });

    const ends = toolEnds(harness.events);
    expect(harness.checkCalls).toBe(0);
    expect(harness.createCalls).toBe(0);
    expect(ends.map((end) => end.status)).toEqual(['error', 'error']);

    // 首条：拒绝卡片（结论 + 明细点名未注册函数 + 终局指令）
    expect(ends[0]!.resultText).toContain('前置规则引用了未注册函数');
    expect(ends[0]!.resultText).toContain('未注册函数：');
    expect(ends[0]!.resultText).toContain(RULE_TERMINAL_NOTICE);
    // 次条：020 读到同一份挂起状态，直接拦下
    expect(ends[1]!.resultText).toBe(SUSPENDED_MESSAGE);

    // 软收尾：第 3 跳模型正常总结收尾（hop 3 = stop），没有 error 事件
    expect(hasErrorEvent(harness.events)).toBe(false);
    expect(harness.stops).toBe(0);
    expect(harness.hops).toBe(3);
    expect(harness.events.some((event) => event.type === 'done')).toBe(true);
  });
});

describe('模型固执重试 → 兜底纯中止（有界退出）', () => {
  it('第 2 次被挂起拦截后触发一次纯中止，之后不再执行任何工具', async () => {
    const harness = await runScript({
      steps: [toolStep('c1', CREATE), toolStep('c2', CHECK), toolStep('c3', STOCK), stopStep()],
      available: [CREATE],
    });

    expect(harness.checkCalls).toBe(0);
    expect(harness.stockCalls).toBe(0);
    expect(harness.createCalls).toBe(0);
    // 第 2 次拦截（attempts > 1）触发兜底；单轮最多一次
    expect(harness.stops).toBe(1);
  });
});
