/**
 * 本体行为规则闸门的**唯一** AgentTool 包装器（021）。
 *
 * 与 `tool-scope-guard.ts`（020）同形：只做"执行前拦住/放行"，不含任何业务知识。
 * 2026-11-24 起，执行成功后不再有任何追加或阻断（后置规则整体移除、待重新设计）。
 *
 * 解耦红线（本文件 MUST 守住）：
 * - 不出现具体工具名、MCP 服务名、本体名、yaml 字段名；
 * - 不解析文件、不判规则——所有判定来自 `domain/rule-gate` 的端口；
 * - 暂停 / 拒绝 / 致命错误都不走 `throw`，复用 `domain/tool-error.js` 的统一失败标记。
 *
 * 顺序约定：本包装器在 020 权限闸门**内侧**（`guardTools(ruleGateTools(tools))`），
 * 因此被权限闸门拒绝的调用不会进入这里——既不判定也不记录（`FR-009`）。
 *
 * 三种收尾（2026-11-24 收敛）：
 * - `deny`：软收尾——挂起本轮全部工具，模型据「结论 + 明细 + 终局指令」总结后正常 `done`；
 * - `fatal`：非法配置——挂起并**立即**结束本轮（复用 `ABORTED` 通道，不等模型再调）；
 * - `command` 执行返回：**写后失效**——既有函数结果过期，下一个 command 必须重算。
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';

import {
  RULE_DENIED_CODE,
  RULE_FUNCTIONS_MISSING_CODE,
  denyCardBody,
  type FunctionRecord,
  type PrepareResult,
  type RuleDiagnosis,
  type RuleGatePort,
} from '../domain/rule-gate/index.js';
import { appendToolText, readToolError, toolErrorResult } from '../domain/tool-error.js';
import {
  SUSPENDED_MESSAGE,
  abortRunFatal,
  interceptSuspended,
  suspendTools,
  type ToolSuspension,
} from '../domain/tool-suspension.js';

/** 包装器需要的上下文（全部由装配层提供） */
export interface RuleGateContext {
  gate: RuleGatePort;
  /** 本轮函数记录（每轮新建；本体 command 执行返回后内部推进世代） */
  record: FunctionRecord;
  /** 平台内置工具名（不判定、不记录） */
  builtinNames: ReadonlySet<string>;
  /** 本轮挂载给模型的工具名（含内置，已按"完整名 + 去前缀名"归一） */
  availableNames: ReadonlySet<string>;
  /**
   * 本轮工具挂起状态：与 020 权限闸门**共享同一份实例**（装配层每轮创建一次）。
   *
   * 021 在内侧，模型后续的工具调用会先过 020；两层必须看到同一份状态，
   * 否则"规则拒绝"之后仍可能被 020 放行并执行。
   */
  suspension: ToolSuspension;
  logger: Logger;
  userId: string;
  agentName: string;
  threadId?: string;
}

/** 逐工具包装（每工具仅一次）；空数组原样返回 */
export function ruleGateTools(tools: AgentTool[], ctx: RuleGateContext): AgentTool[] {
  return tools.map((tool) => wrapToolWithRuleGate(tool, ctx));
}

export function wrapToolWithRuleGate(tool: AgentTool, ctx: RuleGateContext): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      // 0. 本轮已挂起（020 或本闸门此前拒绝过）：不判定、不执行。
      //    生产装配下 020 在外侧先拦，这里覆盖"单独使用本包装器"的场景。
      if (interceptSuspended(ctx.suspension)) {
        logSuspended(ctx, tool.name, ctx.suspension.attempts, ctx.suspension.code);
        return toolErrorResult(SUSPENDED_MESSAGE, ctx.suspension.code);
      }

      // 1. 内置工具：原样执行；不判定、不记录、不追加
      if (ctx.builtinNames.has(tool.name)) return tool.execute(toolCallId, params);

      // 派发世代：`prepare` 是同步的，两者同值；并行批次里函数先派发、command 后完成时，
      // 按提交时的世代打戳会把它伪装成"写后计算"，必须按派发世代降级为过期。
      const dispatchedEpoch = ctx.record.epoch;
      const prepared = prepareSafely(ctx, tool.name);

      // 2. 致命配置错误：不执行、不判规则，**立即结束本轮**（配置错误不可自愈）
      if (prepared.kind === 'fatal') {
        abortRunFatal(ctx.suspension, RULE_DENIED_CODE);
        logFatal(ctx, tool.name, prepared);
        return appendToolText(
          toolErrorResult(prepared.message, RULE_DENIED_CODE),
          denyCardBody(prepared.details),
        );
      }

      // 3. 暂停：不执行，返回失败结果（本轮继续，模型可补调后重试）
      if (prepared.kind === 'pause') {
        logEvent(ctx, 'info', 'rule_gate.paused', {
          tool_name: tool.name,
          ...diagnosisFields(prepared.diagnosis),
          ...(prepared.diagnosis?.missingFunctions !== undefined
            ? { missing_functions: prepared.diagnosis.missingFunctions }
            : {}),
          ...(prepared.diagnosis?.staleFunctions !== undefined
            ? { stale_functions: prepared.diagnosis.staleFunctions }
            : {}),
        });
        return toolErrorResult(prepared.message, RULE_FUNCTIONS_MISSING_CODE);
      }

      // 4. 拒绝：不执行、挂起本轮，卡片给出「结论 + 明细 + 终局指令」（软收尾）
      if (prepared.kind === 'deny') {
        suspendTools(ctx.suspension, RULE_DENIED_CODE);
        logDenied(ctx, tool.name, prepared);
        return appendToolText(
          toolErrorResult(prepared.message, RULE_DENIED_CODE),
          denyCardBody(prepared.details),
        );
      }

      let result: AgentToolResult<unknown>;
      try {
        result = await tool.execute(toolCallId, params);
      } catch (err) {
        // 调用**已发出**：函数角色记 null（行为不记录，`FR-002`）
        if (prepared.kind === 'function') ctx.record.add(tool.name, null, dispatchedEpoch);
        // command 已发出即无法排除写入：抛错同样使既有函数结果失效
        if (prepared.kind === 'behavior' && prepared.command === true) {
          invalidateRecord(ctx, tool.name);
        }
        throw err;
      }

      // 5. 函数角色：成败都记（失败标记 → null），结果原样返回
      if (prepared.kind === 'function') {
        ctx.record.add(tool.name, isFailed(result) ? null : result, dispatchedEpoch);
        return result;
      }

      // 6. 行为角色：判定已在执行前完成，结果原样返回。
      //    command（写操作）执行后使既有函数结果失效：下一个 command 的前置规则
      //    必须重新计算，不能复用上一次的结论。query 恒不失效。
      if (prepared.command === true) invalidateRecord(ctx, tool.name);
      return result;
    },
  };
}

/**
 * 使既有函数结果失效（2026-11-24）。
 *
 * 语义是"过期"而不是"删除"：条目保留，`has` / `get` 只认新世代，
 * 文案因此能区分"从未执行"与"执行过但过期"。日志只记条数，不记结果正文（`FR-040`）。
 */
function invalidateRecord(ctx: RuleGateContext, toolName: string): void {
  ctx.record.invalidate();
  logEvent(ctx, 'info', 'rule_gate.record.invalidated', {
    tool_name: toolName,
    epoch: ctx.record.epoch,
    stale_count: ctx.record.size - ctx.record.activeSize,
  });
}

/** `prepare` 契约是"永不抛"；实现违约时按 fail-closed 拒绝（不放行） */
function prepareSafely(ctx: RuleGateContext, toolName: string): PrepareResult {
  try {
    return ctx.gate.prepare({
      toolName,
      record: ctx.record,
      available: ctx.availableNames,
    });
  } catch {
    return {
      kind: 'deny',
      message: '本体行为未通过规则校验：规则配置不可用，本次调用已拒绝。',
      details: ['原因：规则配置不可用（判定过程异常）'],
      reason: 'config_unavailable',
    };
  }
}

/** 结果是否带失败标记（唯一判据是 `details.toolError`） */
function isFailed(result: AgentToolResult<unknown>): boolean {
  return readToolError(result.details) !== undefined;
}

function diagnosisFields(diagnosis: RuleDiagnosis | undefined): Record<string, unknown> {
  if (diagnosis === undefined) return {};
  return {
    ontology: diagnosis.ontologyKey,
    behavior: diagnosis.behaviorName,
    rules: diagnosis.rules,
  };
}

/**
 * 致命配置错误的日志（2026-11-24）：`error` 级 + `alert: true`。
 *
 * 与 `deny` 的区别只在收尾：fatal 立即结束本轮，因此必须保证这条记录一定落下。
 */
function logFatal(
  ctx: RuleGateContext,
  toolName: string,
  prepared: Extract<PrepareResult, { kind: 'fatal' }>,
): void {
  logEvent(ctx, 'error', 'rule_gate.fatal', {
    tool_name: toolName,
    ...diagnosisFields(prepared.diagnosis),
    reason: prepared.reason,
    cause: prepared.cause,
    alert: true,
  });
}

function logDenied(
  ctx: RuleGateContext,
  toolName: string,
  prepared: Extract<PrepareResult, { kind: 'deny' }>,
): void {
  const diagnosis = prepared.diagnosis;
  logEvent(ctx, 'warn', 'rule_gate.denied', {
    tool_name: toolName,
    ...diagnosisFields(diagnosis),
    reason: prepared.reason,
    ...(diagnosis?.failedConditions !== undefined
      ? {
          failed_conditions: diagnosis.failedConditions.slice(0, 10).map((item) => ({
            rule: item.rule,
            function: item.function,
            field: item.field,
            operator: item.operator,
          })),
        }
      : {}),
    ...(diagnosis?.unregisteredFunctions !== undefined
      ? { unregistered_functions: diagnosis.unregisteredFunctions }
      : {}),
  });

  if (prepared.reason === 'config_unavailable') {
    logEvent(ctx, 'error', 'rule_gate.unavailable', {
      tool_name: toolName,
      ...diagnosisFields(diagnosis),
      reason: 'bad_design',
      alert: true,
    });
  }
}

/**
 * 挂起后的每次工具调用：只记"被拦了几次"（判定字段已由上一条 `denied` 记录）。
 *
 * `attempts` 是兜底阈值的唯一依据：`>1` 即触发 `onExhausted`（纯中止本轮），
 * 避免模型"换个工具再试"把软收尾拖成死循环。
 */
function logSuspended(
  ctx: RuleGateContext,
  toolName: string,
  attempts: number,
  code: string,
): void {
  logEvent(ctx, 'warn', 'rule_gate.suspended', { tool_name: toolName, code, attempts });
}

type LogLevel = 'info' | 'warn' | 'error';

/** 统一的结构化日志：每个事件都带 `event` 与 `ts`（`FR-035` / `SC-005`） */
function logEvent(
  ctx: RuleGateContext,
  level: LogLevel,
  event: string,
  fields: Record<string, unknown>,
): void {
  try {
    ctx.logger[level](
      {
        event,
        ts: new Date().toISOString(),
        user_id: ctx.userId,
        agent_name: ctx.agentName,
        ...(ctx.threadId !== undefined ? { thread_id: ctx.threadId } : {}),
        ...fields,
      },
      event,
    );
  } catch {
    // 日志故障不影响判定结果
  }
}
