import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { vi } from 'vitest';

import { matchKeys } from '../../../src/domain/ontology-doc.js';
import { createOntologyFactsLoader } from '../../../src/domain/plan/ontology-facts.js';
import type { PlanFinishReason, PlanState } from '../../../src/domain/plan/types.js';
import { createRuleGate } from '../../../src/domain/rule-gate/gate.js';
import { createFunctionRecord } from '../../../src/domain/rule-gate/record.js';
import { createScopeGuard } from '../../../src/domain/scope-guard/index.js';
import { createToolSuspension } from '../../../src/domain/tool-suspension.js';
import { runAgentLoopEvents } from '../../../src/infra/agent-loop.js';
import { createPlanOrchestrator } from '../../../src/infra/plan-orchestrator.js';
import { ruleGateTools } from '../../../src/infra/tool-rule-gate.js';
import { guardTools } from '../../../src/infra/tool-scope-guard.js';
import type { LlmEvent } from '../../../src/types.js';

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function assistant(content: unknown[], stopReason: 'toolUse' | 'stop'): AssistantMessage {
  return { role: 'assistant', content, stopReason, usage: USAGE, timestamp: Date.now() } as never;
}

export function say(text: string): AssistantMessage {
  return assistant([{ type: 'text', text }], 'stop');
}

export function call(name: string, id: string, args: Record<string, unknown> = {}): AssistantMessage {
  return assistant([{ type: 'toolCall', id, name, arguments: args }], 'toolUse');
}

export function fakeStream(message: AssistantMessage) {
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

export interface HopContext {
  systemPrompt?: string;
  messages?: Array<{ role: string; content: unknown }>;
  tools?: Array<{ name: string }>;
}

export interface PlanRunOptions {
  ontologyYaml: string;
  tools: AgentTool[];
  planOutputs: string[];
  loopTurn: (hop: number) => AssistantMessage;
  focusPrompt?: string;
  userInput?: string;
  /**
   * 授权白名单（020 权限闸门）。缺省从本体行为/函数名派生：
   * 没有 `securities.yaml` 时闸门按「授权配置不可用」安全拒绝，用例会假失败。
   */
  securities?: string[];
  /** 兜底跳数上限（防止用例自身写出死循环） */
  maxHops?: number;
}

export interface PlanRunResult {
  events: LlmEvent[];
  state: PlanState;
  finish: PlanFinishReason | null;
  planCalls: number;
  planMessages: string[];
  logs: Array<Record<string, unknown>>;
  suspends: string[];
  hops: number;
  contexts: HopContext[];
  initialTools: string[];
}

const tmpDirs: string[] = [];

export function cleanupFixtures(): void {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
}

function fixtureAgentDir(ontologyYaml: string, securities: string[]): string {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'optagent-plan-loop-'));
  tmpDirs.push(agentDir);
  const dir = path.join(agentDir, 'ontology', '原材料采购和库存', '采购单');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ontology.yaml'), ontologyYaml, 'utf8');
  if (securities.length > 0) {
    const lines = ['securities:'];
    for (const name of securities) lines.push(`  - action_name: ${name}`, '    scope: [admin]');
    fs.writeFileSync(path.join(dir, 'securities.yaml'), `${lines.join('\n')}\n`, 'utf8');
  }
  return agentDir;
}

export async function runPlanned(options: PlanRunOptions): Promise<PlanRunResult> {
  const agentDir = fixtureAgentDir(options.ontologyYaml, options.securities ?? []);
  const gate = createRuleGate({ agentDir });
  const record = createFunctionRecord();
  const controller = new AbortController();
  const suspends: string[] = [];
  const suspension = createToolSuspension((code) => suspends.push(code));

  const logged: Array<Record<string, unknown>> = [];
  let stateOf: (() => PlanState) | null = null;
  const withSnapshot = (fields: Record<string, unknown>): Record<string, unknown> => {
    const state = stateOf?.();
    if (state === undefined || state === null) return { ...fields };
    return {
      ...fields,
      _state: { roll: state.rollCount, replan: state.replanCount, total: state.totalSteps },
    };
  };
  const logger = {
    info: (fields: Record<string, unknown>) => logged.push(withSnapshot(fields)),
    warn: (fields: Record<string, unknown>) => logged.push(withSnapshot(fields)),
    error: () => undefined,
  };

  const availableNames = new Set<string>();
  for (const item of options.tools) {
    for (const key of matchKeys(item.name)) availableNames.add(key);
  }

  const ruled = ruleGateTools(options.tools, {
    gate,
    record,
    builtinNames: new Set<string>(),
    availableNames,
    suspension,
    logger: logger as never,
    userId: 'admin',
    agentName: '采购助手',
    threadId: 't_1',
  });

  const guarded = guardTools(
    ruled,
    createScopeGuard({ agentDir, username: 'admin' }),
    { logger: logger as never, userId: 'admin', agentName: '采购助手', threadId: 't_1' },
    suspension,
  );

  const loader = createOntologyFactsLoader(agentDir);
  const scripts = [...options.planOutputs];
  let planCalls = 0;
  const planMessages: string[] = [];
  const plan = vi.fn(async (request: { messages: Array<{ content: string }> }) => {
    planCalls += 1;
    planMessages.push(request.messages.at(-1)?.content ?? '');
    const next = scripts.shift();
    if (next === undefined) throw new Error('规划脚本已用尽（用例脚本不足）');
    return next;
  });

  const orchestrator = createPlanOrchestrator({
    goal: '补采购',
    userInput: options.userInput ?? '帮我补齐缺料采购',
    focusPrompt: options.focusPrompt ?? '［聚焦结果］CreatePurchaseRecord / SubmitPurchase / checkStock',
    history: [],
    tools: guarded,
    ontology: loader.getIndex(),
    facts: loader.get(),
    behaviorOf: (name) => gate.lookupBehavior(name),
    isStale: (name) => record.hasEver(name) && !record.has(name),
    plan: plan as never,
    signal: controller.signal,
    logger,
    suspend: (code) => suspends.push(code),
  });

  stateOf = () => orchestrator.state();

  const result: PlanRunResult = {
    events: [],
    state: orchestrator.state(),
    finish: null,
    planCalls: 0,
    planMessages,
    logs: logged,
    suspends,
    hops: 0,
    contexts: [],
    initialTools: [],
  };

  const ready = await orchestrator.begin();
  result.planCalls = planCalls;
  result.finish = orchestrator.finishReason();
  if (!ready) return result;

  result.initialTools = orchestrator.initialTools().map((item) => item.name);

  const maxHops = options.maxHops ?? 12;
  const streamFn = ((_model: unknown, context: HopContext) => {
    result.contexts.push(context);
    const message = options.loopTurn(result.hops);
    result.hops += 1;
    if (result.hops > maxHops) throw new Error(`超过最大跳数 ${maxHops}（疑似死循环）`);
    return fakeStream(message);
  }) as never;

  for await (const event of runAgentLoopEvents({
    model: {} as never,
    streamFn,
    systemPrompt: 'SYS',
    messages: orchestrator.initialMessages([{ role: 'user', content: options.userInput ?? '帮我补齐缺料采购' }]),
    tools: orchestrator.initialTools(),
    thinking: false,
    signal: controller.signal,
    hooks: orchestrator.hooks,
  })) {
    result.events.push(event);
  }

  result.finish = orchestrator.finishReason();
  result.planCalls = planCalls;
  return result;
}

export function jsonTool(name: string, label: string, body: Record<string, unknown> = { ok: true }): AgentTool {
  return {
    name,
    label,
    description: `${name} 描述`,
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => ({
      content: [{ type: 'text', text: JSON.stringify(body) }],
      details: {},
    }),
  } as unknown as AgentTool;
}

export function countingTool(
  name: string,
  label: string,
  body: Record<string, unknown> = { ok: true },
): { tool: AgentTool; calls: () => number } {
  const counter = { value: 0 };
  const tool = {
    name,
    label,
    description: `${name} 描述`,
    parameters: { type: 'object', properties: {} } as never,
    execute: async () => {
      counter.value += 1;
      return { content: [{ type: 'text', text: JSON.stringify(body) }], details: {} };
    },
  } as unknown as AgentTool;
  return { tool, calls: () => counter.value };
}

export function toolEnds(events: LlmEvent[]): Array<{ status: string; resultText?: string }> {
  return events.filter((event) => event.type === 'tool_call_end') as never;
}
