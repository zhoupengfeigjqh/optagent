/**
 * 单元测试：规则闸门包装器（infra，021）。
 *
 * 守住的语义：
 * - `pause` / `deny` 时真实 `execute` **零调用**，返回结果带对应失败码；
 * - `deny` 即挂起本轮（与 020 共享状态），卡片含「结论 + 明细 + 终局指令」，不制造失败轮；
 * - 挂起后其余工具（含内置）一律不执行，返回挂起码；
 * - `function` 角色**成败都记录**（失败传 `null`），结果原样返回；
 * - `behavior` 角色判定通过后结果原样返回：2026-11-24 起执行成功后不再追加任何文本；
 * - 内置工具不判定、不记录，且与函数同名时仍按内置优先；
 * - 包装保持 name/label/description/parameters/executionMode 不变（模型侧无感）；
 * - 暂停/拒绝日志字段齐全且**含 `ts`**，不含结果正文与入参。
 */
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { describe, expect, it, vi } from 'vitest';

import { RULE_TERMINAL_NOTICE, denyCardBody } from '../../src/domain/rule-gate/format.js';
import { createFunctionRecord } from '../../src/domain/rule-gate/record.js';
import type { PrepareResult, RuleGatePort } from '../../src/domain/rule-gate/types.js';
import { readToolError } from '../../src/domain/tool-error.js';
import {
  SUSPENDED_MESSAGE,
  createToolSuspension,
  suspendTools,
} from '../../src/domain/tool-suspension.js';
import {
  ruleGateTools,
  wrapToolWithRuleGate,
  type RuleGateContext,
} from '../../src/infra/tool-rule-gate.js';

type FakeLogger = {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const DIAGNOSIS = {
  ontologyKey: '原材料采购和库存/采购单',
  behaviorName: 'CreatePurchaseRecord',
  rules: ['采购-供应商名称一致'],
};

function makeTool(name = 'erp__CreatePurchaseRecord') {
  const executeMock = vi.fn(async (_callId: string, _params: unknown) => ({
    content: [{ type: 'text', text: '{"ok":true}' }],
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

function makeGate(prepareResult: PrepareResult) {
  const gate = {
    prepare: vi.fn(() => prepareResult),
    invalidate: vi.fn(),
  };
  return gate as unknown as RuleGatePort & {
    prepare: ReturnType<typeof vi.fn>;
  };
}

function makeContext(gate: RuleGatePort, overrides: Partial<RuleGateContext> = {}) {
  const logger: FakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const record = createFunctionRecord();
  const suspension = createToolSuspension();
  const ctx: RuleGateContext = {
    gate,
    record,
    builtinNames: new Set<string>(),
    availableNames: new Set(['erp__createpurchaserecord', 'createpurchaserecord']),
    suspension,
    logger: logger as never,
    userId: 'u_001',
    agentName: '采购助手',
    threadId: 't_001',
    ...overrides,
  };
  return { ctx, logger, record, suspension: ctx.suspension };
}

const PAUSE: PrepareResult = {
  kind: 'pause',
  message: '前置规则所需函数尚未执行',
  details: ['缺失函数：checkSupplierExistence'],
  diagnosis: { ...DIAGNOSIS, missingFunctions: ['checkSupplierExistence'] },
};

const DENY: PrepareResult = {
  kind: 'deny',
  message: '未通过前置规则校验',
  details: ['结论：供应商名称不存在'],
  reason: 'condition_false',
  diagnosis: { ...DIAGNOSIS, failedConditions: [] },
};

describe('pause / deny', () => {
  it('pause：execute 零调用，返回暂停码', async () => {
    const tool = makeTool();
    const { ctx } = makeContext(makeGate(PAUSE));
    const wrapped = wrapToolWithRuleGate(tool, ctx);

    const result = await wrapped.execute('call-1', { qty: 1 });

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(readToolError(result.details)?.code).toBe('ONTOLOGY_RULE_FUNCTIONS_MISSING');
    expect(result.content).toEqual([{ type: 'text', text: PAUSE.kind === 'pause' ? PAUSE.message : '' }]);
  });

  it('deny：execute 零调用，卡片含结论+明细+终局指令，并挂起本轮', async () => {
    const tool = makeTool();
    const { ctx, suspension } = makeContext(makeGate(DENY));
    const wrapped = wrapToolWithRuleGate(tool, ctx);

    const result = await wrapped.execute('call-1', {});

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(readToolError(result.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    // 拒绝不写失败轮：挂起状态交给下一批调用拦截，本轮由模型总结后正常收尾
    expect(suspension).toMatchObject({
      suspended: true,
      code: 'ONTOLOGY_RULE_DENIED',
      attempts: 0,
    });
    expect(result.content).toEqual([
      { type: 'text', text: '未通过前置规则校验' },
      { type: 'text', text: denyCardBody(['结论：供应商名称不存在']) },
    ]);
    const card = JSON.stringify(result.content);
    expect(card).toContain('结论：供应商名称不存在');
    expect(card).toContain(RULE_TERMINAL_NOTICE);
  });

  it('挂起后其余工具（含内置）一律不执行，返回挂起码', async () => {
    const { ctx, suspension } = makeContext(makeGate(DENY), {
      builtinNames: new Set(['read_file']),
    });

    const first = makeTool();
    await wrapToolWithRuleGate(first, ctx).execute('call-1', {});

    const builtin = makeTool('read_file');
    const other = makeTool('erp__checkStock');
    const blocked = await wrapToolWithRuleGate(builtin, ctx).execute('call-2', {});
    const blockedOther = await wrapToolWithRuleGate(other, ctx).execute('call-3', {});

    expect(first.executeMock).not.toHaveBeenCalled();
    expect(builtin.executeMock).not.toHaveBeenCalled();
    expect(other.executeMock).not.toHaveBeenCalled();
    expect(readToolError(blocked.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    expect(blocked.content).toEqual([{ type: 'text', text: SUSPENDED_MESSAGE }]);
    expect(readToolError(blockedOther.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    expect(suspension.attempts).toBe(2);
  });

  it('兜底出口抛错不影响拦截结果', async () => {
    const tool = makeTool();
    const { ctx, suspension } = makeContext(makeGate({ kind: 'behavior' }), {
      suspension: createToolSuspension(() => {
        throw new Error('stop is broken');
      }),
    });
    suspendTools(suspension, 'ONTOLOGY_RULE_DENIED');

    const first = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});
    expect(readToolError(first.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    // 第 2 次拦截触发兜底；回调抛错被吞掉，结果仍是挂起码
    const second = await wrapToolWithRuleGate(tool, ctx).execute('call-2', {});
    expect(readToolError(second.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    expect(suspension).toMatchObject({ attempts: 2, exhausted: true });
  });

  it('日志：暂停/拒绝字段齐全且含 ts，不记入参', async () => {
    const tool = makeTool();
    const pauseCtx = makeContext(makeGate(PAUSE));
    await wrapToolWithRuleGate(tool, pauseCtx.ctx).execute('call-1', { secret: 'x' });

    const paused = pauseCtx.logger.info.mock.calls[0]![0] as Record<string, unknown>;
    expect(paused).toMatchObject({
      event: 'rule_gate.paused',
      tool_name: tool.name,
      ontology: DIAGNOSIS.ontologyKey,
      behavior: DIAGNOSIS.behaviorName,
      rules: DIAGNOSIS.rules,
      missing_functions: ['checkSupplierExistence'],
      user_id: 'u_001',
      agent_name: '采购助手',
    });
    expect(typeof paused.ts).toBe('string');
    expect(JSON.stringify(paused)).not.toContain('secret');

    const denyCtx = makeContext(makeGate(DENY));
    await wrapToolWithRuleGate(tool, denyCtx.ctx).execute('call-1', {});
    const denied = denyCtx.logger.warn.mock.calls[0]![0] as Record<string, unknown>;
    expect(denied).toMatchObject({ event: 'rule_gate.denied', reason: 'condition_false' });
    expect(typeof denied.ts).toBe('string');
  });

  it('config_unavailable：额外记一条 alert 的 unavailable 事件', async () => {
    const tool = makeTool();
    const { ctx, logger } = makeContext(
      makeGate({ ...DENY, reason: 'config_unavailable' }),
    );
    await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    const unavailable = logger.error.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).event === 'rule_gate.unavailable',
    );
    expect(unavailable).toBeDefined();
    expect(unavailable![0]).toMatchObject({ alert: true, reason: 'bad_design' });
  });
});

describe('fatal：非法本体行为（2026-11-24）', () => {
  const FATAL: PrepareResult = {
    kind: 'fatal',
    message: '本体行为「原材料采购和库存/采购单/CreatePurchaseRecord」的 op_type 不是 query 或 command，本次调用已拒绝，本轮已中止。',
    details: ['行为：原材料采购和库存/采购单/CreatePurchaseRecord', '原因：op_type 非法'],
    reason: 'config_unavailable',
    cause: 'bad_op_type',
    diagnosis: { ...DIAGNOSIS, rules: [] },
  };

  it('execute 零调用，立即触发收尾（不等第 2 次），并记 alert 日志', async () => {
    const tool = makeTool();
    const onExhausted = vi.fn();
    const { ctx, logger, suspension } = makeContext(makeGate(FATAL), {
      suspension: createToolSuspension(onExhausted),
    });

    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(tool.executeMock).not.toHaveBeenCalled();
    expect(readToolError(result.details)?.code).toBe('ONTOLOGY_RULE_DENIED');
    expect(result.content).toEqual([
      { type: 'text', text: FATAL.kind === 'fatal' ? FATAL.message : '' },
      { type: 'text', text: denyCardBody(FATAL.details) },
    ]);
    // 立即收尾：挂起 + 兜底出口在同一次调用内触发
    expect(suspension).toMatchObject({ suspended: true, exhausted: true });
    expect(onExhausted).toHaveBeenCalledTimes(1);

    const fatalLog = logger.error.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).event === 'rule_gate.fatal',
    );
    expect(fatalLog).toBeDefined();
    expect(fatalLog![0]).toMatchObject({ alert: true, cause: 'bad_op_type' });
  });
});

describe('command 写后失效（2026-11-24）', () => {
  it('command 执行成功：既有函数结果过期（保留历史），结果原样返回', async () => {
    const tool = makeTool();
    const { ctx, record, logger } = makeContext(makeGate({ kind: 'behavior', command: true }));
    record.add('checkSupplierExistence', { pass: true });

    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
    expect(record.epoch).toBe(1);
    expect(record.has('checkSupplierExistence')).toBe(false);
    expect(record.hasEver('checkSupplierExistence')).toBe(true);

    const log = logger.info.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).event === 'rule_gate.record.invalidated',
    );
    expect(log![0]).toMatchObject({ tool_name: tool.name, epoch: 1, stale_count: 1 });
  });

  it('command 抛错：调用已发出，同样失效后上抛', async () => {
    const tool = makeTool();
    tool.executeMock.mockRejectedValueOnce(new Error('network down'));
    const { ctx, record } = makeContext(makeGate({ kind: 'behavior', command: true }));
    record.add('f', { a: 1 });

    await expect(wrapToolWithRuleGate(tool, ctx).execute('call-1', {})).rejects.toThrow('network down');
    expect(record.epoch).toBe(1);
    expect(record.has('f')).toBe(false);
  });

  it('query（不带 command 标记）执行成功：不失效', async () => {
    const tool = makeTool('erp__QueryPurchaseRecords');
    const { ctx, record } = makeContext(makeGate({ kind: 'behavior' }));
    record.add('f', { a: 1 });

    await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(record.epoch).toBe(0);
    expect(record.has('f')).toBe(true);
  });

  it('函数在 command 之后返回：按派发世代打戳 → 视为过期（不伪装成写后结果）', async () => {
    const tool = makeTool('erp__checkSupplierExistence');
    const { ctx, record } = makeContext(makeGate({ kind: 'function' }));
    // 模拟并行：函数派发（世代 0）后，command 先完成并推进世代，函数随后返回
    tool.executeMock.mockImplementationOnce(async () => {
      record.invalidate();
      return { content: [{ type: 'text', text: '{"ok":true}' }], details: {} };
    });

    await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(record.epoch).toBe(1);
    expect(record.has('checkSupplierExistence')).toBe(false);
    expect(record.hasEver('checkSupplierExistence')).toBe(true);
  });

  it('被暂停 / 拒绝的 command：不失效（行为未执行）', async () => {
    const tool = makeTool();
    const { ctx, record } = makeContext(makeGate(PAUSE));

    await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(record.epoch).toBe(0);
  });
});

describe('function 角色', () => {
  it('成功：记录结果并原样返回（不追加）', async () => {
    const tool = makeTool('erp__checkSupplierExistence');
    const { ctx, record } = makeContext(makeGate({ kind: 'function' }));
    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(record.has('checkSupplierExistence')).toBe(true);
    expect(record.get('checkSupplierExistence')).toEqual({ ok: true });
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });

  it('失败（details.toolError）：记 null 并原样返回', async () => {
    const tool = makeTool('erp__checkSupplierExistence');
    const failed = {
      content: [{ type: 'text', text: 'boom' }],
      details: { toolError: { code: 'MCP_CALL_FAILED', message: 'boom' } },
    };
    tool.executeMock.mockResolvedValueOnce(failed as never);

    const { ctx, record } = makeContext(makeGate({ kind: 'function' }));
    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(record.has('checkSupplierExistence')).toBe(true);
    expect(record.get('checkSupplierExistence')).toBeNull();
    expect(result).toBe(failed);
  });

  it('抛异常：记 null 后上抛', async () => {
    const tool = makeTool('erp__checkSupplierExistence');
    tool.executeMock.mockRejectedValueOnce(new Error('network down'));

    const { ctx, record } = makeContext(makeGate({ kind: 'function' }));
    await expect(wrapToolWithRuleGate(tool, ctx).execute('call-1', {})).rejects.toThrow('network down');
    expect(record.get('checkSupplierExistence')).toBeNull();
  });

  it('function 角色永不追加任何文本', async () => {
    const tool = makeTool('erp__checkSupplierExistence');
    const { ctx } = makeContext(makeGate({ kind: 'function' }));
    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });
});

describe('behavior 角色', () => {
  it('判定通过后结果原样返回（2026-11-24 起不再追加后置提示），且行为本身不写记录', async () => {
    const tool = makeTool();
    const { ctx, record, suspension } = makeContext(makeGate({ kind: 'behavior' }));
    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(tool.executeMock).toHaveBeenCalledTimes(1);
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
    expect(record.size).toBe(0);
    // 没有被挂起：后置规则移除后，执行成功即正常收尾
    expect(suspension.suspended).toBe(false);
  });

  it('行为执行失败（失败标记）→ 结果逐字原样返回', async () => {
    const tool = makeTool();
    const failed = {
      content: [{ type: 'text', text: 'boom' }],
      details: { toolError: { code: 'MCP_CALL_FAILED', message: 'boom' } },
    };
    tool.executeMock.mockResolvedValueOnce(failed as never);

    const { ctx, record } = makeContext(makeGate({ kind: 'behavior' }));
    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(result).toBe(failed);
    expect(record.size).toBe(0);
  });
});

describe('内置工具与保形', () => {
  it('内置工具：不判定、不记录，同名仍按内置优先', async () => {
    const tool = makeTool('checkSupplierExistence');
    const gate = makeGate({ kind: 'pause', message: 'x', details: [] });
    const { ctx, record } = makeContext(gate, {
      builtinNames: new Set(['checkSupplierExistence']),
    });

    const result = await wrapToolWithRuleGate(tool, ctx).execute('call-1', {});

    expect(gate.prepare).not.toHaveBeenCalled();
    expect(record.size).toBe(0);
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true}' }]);
  });

  it('保形：name/label/description/parameters/executionMode 不变', () => {
    const tool = makeTool();
    const { ctx } = makeContext(makeGate({ kind: 'behavior' }));
    const wrapped = wrapToolWithRuleGate(tool, ctx);

    expect(wrapped.name).toBe(tool.name);
    expect(wrapped.label).toBe(tool.label);
    expect(wrapped.description).toBe(tool.description);
    expect(wrapped.parameters).toBe(tool.parameters);
    expect(wrapped.executionMode).toBe(tool.executionMode);
  });

  it('ruleGateTools 逐工具包装，空数组原样返回', () => {
    const a = makeTool('a');
    const b = makeTool('b');
    const { ctx } = makeContext(makeGate({ kind: 'function' }));

    expect(ruleGateTools([], ctx)).toEqual([]);
    const wrapped = ruleGateTools([a, b], ctx);
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0]!.name).toBe('a');
    expect(wrapped[1]!.name).toBe('b');
  });
});
