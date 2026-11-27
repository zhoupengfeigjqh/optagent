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

export interface RuleGateContext {
  gate: RuleGatePort;
  record: FunctionRecord;
  builtinNames: ReadonlySet<string>;
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

export function ruleGateTools(tools: AgentTool[], ctx: RuleGateContext): AgentTool[] {
  return tools.map((tool) => wrapToolWithRuleGate(tool, ctx));
}

export function wrapToolWithRuleGate(tool: AgentTool, ctx: RuleGateContext): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      if (interceptSuspended(ctx.suspension)) {
        logSuspended(ctx, tool.name, ctx.suspension.attempts, ctx.suspension.code);
        return toolErrorResult(SUSPENDED_MESSAGE, ctx.suspension.code);
      }

      if (ctx.builtinNames.has(tool.name)) return tool.execute(toolCallId, params);

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
        if (prepared.kind === 'function') ctx.record.add(tool.name, null, dispatchedEpoch);
        if (prepared.kind === 'behavior' && prepared.command === true) {
          invalidateRecord(ctx, tool.name);
        }
        throw err;
      }

      if (prepared.kind === 'function') {
        ctx.record.add(tool.name, isFailed(result) ? null : result, dispatchedEpoch);
        return result;
      }

      //    必须重新计算，不能复用上一次的结论。query 恒不失效。
      if (prepared.command === true) invalidateRecord(ctx, tool.name);
      return result;
    },
  };
}

function invalidateRecord(ctx: RuleGateContext, toolName: string): void {
  ctx.record.invalidate();
  logEvent(ctx, 'info', 'rule_gate.record.invalidated', {
    tool_name: toolName,
    epoch: ctx.record.epoch,
    stale_count: ctx.record.size - ctx.record.activeSize,
  });
}

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
    // 审计写失败不影响主流程
  }
}
