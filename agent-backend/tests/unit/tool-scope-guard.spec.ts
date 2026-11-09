/**
 * 单元测试：权限闸门包装器（infra，020）。
 *
 * 守住的语义：
 * - 放行 / 非本体：真实 `execute` 收到**同一** `(toolCallId, params)`，结果原样透传；
 * - 拒绝：真实 `execute` **零调用**，返回带失败标记的结果（卡片标红的唯一依据）；
 * - 拒绝**先于**人工确认：被拒的调用不会触发 `InteractionSink.request`（`FR-002`）；
 * - 拒绝记录字段齐全，且**不含**授权名单（只记形态与数量）；
 * - 包装保持 name/label/description/parameters/executionMode 不变（模型侧无感）。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import type { InteractionOutcome } from '../../src/domain/interaction-gate.js';
import {
  SCOPE_TERMINAL_NOTICE,
  type ScopeDecision,
  type ScopeGuardPort,
} from '../../src/domain/scope-guard/index.js';
import { readToolError } from '../../src/domain/tool-error.js';
import { SUSPENDED_MESSAGE, createToolSuspension } from '../../src/domain/tool-suspension.js';
import { wrapToolWithInteraction } from '../../src/infra/tool-intercept.js';
import { guardTools, wrapToolWithScopeGuard } from '../../src/infra/tool-scope-guard.js';

type FakeLogger = { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

const BEHAVIOR = {
  ontologyKey: '生产调度/原材料采购和库存',
  scenarioName: '生产调度',
  ontologyName: '原材料采购和库存',
  behaviorName: 'CreatePurchaseRecord',
};

const DENY: ScopeDecision = {
  kind: 'deny',
  behavior: BEHAVIOR,
  code: 'ONTOLOGY_SCOPE_DENIED',
  reason: 'not_in_scope',
  scopeKind: 'users',
  scopeSize: 1,
  message: '本体行为「原材料采购和库存/CreatePurchaseRecord」未授权给当前用户，已拒绝执行。',
};

function makeTool(name = 'mes__CreatePurchaseRecord') {
  const executeMock = vi.fn(async (_callId: string, _params: unknown) => ({
    content: [{ type: 'text', text: 'executed' }],
    details: {},
  }));
  const tool: AgentTool = {
    name,
    label: '创建采购单',
    description: '创建一笔原材料采购单',
    parameters: { type: 'object', properties: { qty: { type: 'number' } } } as never,
    executionMode: 'sequential',
    execute: executeMock as never,
  };
  return Object.assign(tool, { executeMock });
}

function makeGuard(decision: ScopeDecision): ScopeGuardPort & { check: ReturnType<typeof vi.fn> } {
  return {
    check: vi.fn(() => decision),
    invalidate: vi.fn(),
  } as unknown as ScopeGuardPort & { check: ReturnType<typeof vi.fn> };
}

function makeCtx(logger: FakeLogger = { warn: vi.fn(), error: vi.fn() }) {
  return {
    logger: logger as never,
    userId: 'admin',
    agentName: '采购助手',
    threadId: 't_1',
  };
}

describe('wrapToolWithScopeGuard', () => {
  it('放行：真实 execute 收到同一 (toolCallId, params)，结果原样透传', async () => {
    const tool = makeTool();
    const guard = makeGuard({ kind: 'allow', behavior: BEHAVIOR, rule: 'user' });
    const wrapped = wrapToolWithScopeGuard(tool, guard, makeCtx());

    const result = await wrapped.execute('call_1', { qty: 5 });

    expect(tool.executeMock).toHaveBeenCalledTimes(1);
    expect(tool.executeMock).toHaveBeenCalledWith('call_1', { qty: 5 });
    expect(result.content).toEqual([{ type: 'text', text: 'executed' }]);
  });

  it('非本体工具：直接透传（闸门不改行为）', async () => {
    const tool = makeTool('read_file');
    const guard = makeGuard({ kind: 'not_ontology' });
    const wrapped = wrapToolWithScopeGuard(tool, guard, makeCtx());

    await wrapped.execute('call_2', { path: 'data/x.txt' });

    expect(tool.executeMock).toHaveBeenCalledTimes(1);
  });

  it('拒绝：真实 execute 零调用，返回失败标记 + 终局指令（指令不进结构化字段）', async () => {
    const tool = makeTool();
    const guard = makeGuard(DENY);
    const wrapped = wrapToolWithScopeGuard(tool, guard, makeCtx());

    const result = await wrapped.execute('call_3', { qty: 5 });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(readToolError(result.details)).toEqual({ code: 'ONTOLOGY_SCOPE_DENIED', message: DENY.message });
    expect(result.content).toEqual([
      { type: 'text', text: DENY.message },
      { type: 'text', text: SCOPE_TERMINAL_NOTICE },
    ]);
  });

  it('包装保形：name/label/description/parameters/executionMode 不变', () => {
    const tool = makeTool();
    const wrapped = wrapToolWithScopeGuard(tool, makeGuard({ kind: 'not_ontology' }), makeCtx());

    expect(wrapped.name).toBe(tool.name);
    expect(wrapped.label).toBe(tool.label);
    expect(wrapped.description).toBe(tool.description);
    expect(wrapped.parameters).toEqual(tool.parameters);
    expect(wrapped.executionMode).toBe('sequential');
  });

  it('拒绝先于人工确认：不触发 InteractionSink.request，也不调用真实实现', async () => {
    const tool = makeTool();
    const requests: unknown[] = [];
    const sink = {
      request: async (_input: unknown): Promise<InteractionOutcome> => {
        requests.push(_input);
        return { kind: 'submit', args: {} };
      },
    };
    const hitl = wrapToolWithInteraction(tool, sink);
    const wrapped = wrapToolWithScopeGuard(hitl, makeGuard(DENY), makeCtx());

    await wrapped.execute('call_4', { qty: 5 });

    expect(requests).toHaveLength(0);
    expect(tool.executeMock).not.toHaveBeenCalled();
  });

  it('拒绝记录：字段齐全、按码分级、不含授权名单', async () => {
    const tool = makeTool();
    const logger: FakeLogger = { warn: vi.fn(), error: vi.fn() };
    const guard = makeGuard(DENY);

    await wrapToolWithScopeGuard(tool, guard, makeCtx(logger)).execute('call_5', {});

    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [fields, message] = logger.warn.mock.calls[0]!;
    expect(fields).toMatchObject({
      event: 'scope_guard.denied',
      code: 'ONTOLOGY_SCOPE_DENIED',
      reason: 'not_in_scope',
      user_id: 'admin',
      agent_name: '采购助手',
      thread_id: 't_1',
      tool_name: 'mes__CreatePurchaseRecord',
      ontology: '生产调度/原材料采购和库存',
      behavior: 'CreatePurchaseRecord',
      scope_kind: 'users',
      scope_size: 1,
    });
    expect(message).toBe(DENY.message);
    // 不含授权名单（本用例的 scope 只有 1 个元素，且不在日志里出现）
    expect(JSON.stringify(fields)).not.toContain('zpf');
  });

  it('管控不可用：日志走 error 级', async () => {
    const logger: FakeLogger = { warn: vi.fn(), error: vi.fn() };
    const decision: ScopeDecision = {
      kind: 'deny',
      behavior: BEHAVIOR,
      code: 'ONTOLOGY_SCOPE_UNAVAILABLE',
      reason: 'no_entry',
      scopeKind: 'unavailable',
      scopeSize: 0,
      message: '本体行为「原材料采购和库存/CreatePurchaseRecord」的授权配置不可用，已按安全默认拒绝执行；请联系管理员重新部署该本体。',
    };

    await wrapToolWithScopeGuard(makeTool(), makeGuard(decision), makeCtx(logger)).execute('call_6', {});

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('端口违约（check 抛错）：降级为拒绝，不执行真实实现', async () => {
    const tool = makeTool();
    const logger: FakeLogger = { warn: vi.fn(), error: vi.fn() };
    const guard = {
      check: vi.fn(() => {
        throw new Error('boom');
      }),
      invalidate: vi.fn(),
    } as unknown as ScopeGuardPort;

    const result = await wrapToolWithScopeGuard(tool, guard, makeCtx(logger)).execute('call_7', {});

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(readToolError(result.details)?.code).toBe('ONTOLOGY_SCOPE_UNAVAILABLE');
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0]![0]).toMatchObject({
      event: 'scope_guard.evaluator_error',
      tool_name: 'mes__CreatePurchaseRecord',
    });
  });
});

describe('拒绝后挂起本轮（2026-11-09）', () => {
  it('拒绝后同轮的其他工具零执行，且不再重复判定', async () => {
    const guard = makeGuard(DENY);
    const first = makeTool('mes__CreatePurchaseRecord');
    const second = makeTool('mes__DeletePurchaseRecord');
    const [a, b] = guardTools([first, second], guard, makeCtx());

    await a!.execute('c1', {});
    const result = await b!.execute('c2', {});

    expect(second.executeMock).not.toHaveBeenCalled();
    // 挂起后直接拒绝 ⇒ 不再走判定（避免重复判定与重复日志）
    expect(guard.check).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: 'text', text: SUSPENDED_MESSAGE }]);
    expect(readToolError(result.details)?.code).toBe('ONTOLOGY_SCOPE_DENIED');
  });

  it('挂起后第 2 次调用触发兜底中止，且只触发一次', async () => {
    const onExhausted = vi.fn();
    const suspension = createToolSuspension(onExhausted);
    const tools = guardTools(
      [makeTool('a'), makeTool('b'), makeTool('c')],
      makeGuard(DENY),
      makeCtx(),
      suspension,
    );

    await tools[0]!.execute('c1', {}); // 首次拒绝 → 挂起
    await tools[1]!.execute('c2', {}); // attempts=1 → 软拒，不中止
    expect(onExhausted).not.toHaveBeenCalled();

    await tools[2]!.execute('c3', {}); // attempts=2 → 兜底中止
    expect(onExhausted).toHaveBeenCalledTimes(1);

    await tools[2]!.execute('c4', {}); // attempts=3 → 出口已用过，不再重复触发
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('挂起状态按轮隔离：两次装配互不影响', async () => {
    const guard = makeGuard(DENY);
    const round1 = guardTools([makeTool('a')], guard, makeCtx());
    const round2 = guardTools([makeTool('b')], guard, makeCtx());

    await round1[0]!.execute('c1', {});
    const result = await round2[0]!.execute('c2', {});

    // 新一轮仍走判定（而不是"已挂起"的短文案）
    expect(guard.check).toHaveBeenCalledTimes(2);
    expect(result.content[1]).toEqual({ type: 'text', text: SCOPE_TERMINAL_NOTICE });
  });

  it('挂起日志：scope_guard.suspended 记 attempts，不重复记判定字段', async () => {
    const logger: FakeLogger = { warn: vi.fn(), error: vi.fn() };
    const tools = guardTools([makeTool('a'), makeTool('b')], makeGuard(DENY), makeCtx(logger));

    await tools[0]!.execute('c1', {});
    await tools[1]!.execute('c2', {});

    const suspended = logger.warn.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).event === 'scope_guard.suspended',
    );
    expect(suspended![0]).toMatchObject({
      code: 'ONTOLOGY_SCOPE_DENIED',
      tool_name: 'b',
      attempts: 1,
      user_id: 'admin',
      agent_name: '采购助手',
    });
    expect(suspended![0]).not.toHaveProperty('scope_kind');
  });
});

describe('guardTools', () => {
  it('逐工具包装：空数组原样、数量不变、每个工具都会判定', async () => {
    expect(guardTools([], makeGuard({ kind: 'not_ontology' }), makeCtx())).toEqual([]);

    const guard = makeGuard({ kind: 'not_ontology' });
    const tools = guardTools([makeTool('read_file'), makeTool('list_dir')], guard, makeCtx());
    expect(tools).toHaveLength(2);

    await tools[0]!.execute('c1', {});
    await tools[1]!.execute('c2', {});
    expect(guard.check).toHaveBeenCalledTimes(2);
    expect(guard.check).toHaveBeenNthCalledWith(1, 'read_file');
    expect(guard.check).toHaveBeenNthCalledWith(2, 'list_dir');
  });
});
