import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';

import type { ScopeDecision, ScopeGuardPort } from '../domain/scope-guard/index.js';
import {
  SCOPE_GUARD_FALLBACK_CODE,
  SCOPE_GUARD_FALLBACK_MESSAGE,
  SCOPE_TERMINAL_NOTICE,
} from '../domain/scope-guard/index.js';
import { appendToolText, toolErrorResult } from '../domain/tool-error.js';
import {
  SUSPENDED_MESSAGE,
  createToolSuspension,
  interceptSuspended,
  suspendTools,
  type ToolSuspension,
} from '../domain/tool-suspension.js';

export interface ScopeGuardLogContext {
  logger: Logger;
  userId: string;
  agentName: string;
  threadId?: string;
}

type DenyDecision = Extract<ScopeDecision, { kind: 'deny' }>;

/**
 * 逐工具包装（每工具仅一次）；空数组原样返回。挂起状态在**本轮装配内**共享。
 *
 * `suspension` 由装配层传入时与 021 规则闸门共用一份；不传则新建（单独使用本包装器时
 * 退化为"只影响自身"，且没有兜底中止出口）。
 */
export function guardTools(
  tools: AgentTool[],
  guard: ScopeGuardPort,
  ctx: ScopeGuardLogContext,
  suspension?: ToolSuspension,
): AgentTool[] {
  const state = suspension ?? createToolSuspension();
  return tools.map((tool) => wrapToolWithScopeGuard(tool, guard, ctx, state));
}

export function wrapToolWithScopeGuard(
  tool: AgentTool,
  guard: ScopeGuardPort,
  ctx: ScopeGuardLogContext,
  state?: ToolSuspension,
): AgentTool {
  const local: ToolSuspension = state ?? createToolSuspension();

  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      //    注：同一批次的并发兄弟调用无法撤回（`parallel` 模式下已同时发起），
      if (interceptSuspended(local)) {
        logSuspended(ctx, tool.name, local.attempts, local.code);
        return toolErrorResult(SUSPENDED_MESSAGE, local.code);
      }

      let decision: ScopeDecision;
      try {
        decision = guard.check(tool.name);
      } catch (err) {
        logEvaluatorError(ctx, tool.name, err);
        return toolErrorResult(SCOPE_GUARD_FALLBACK_MESSAGE, SCOPE_GUARD_FALLBACK_CODE);
      }
      if (decision.kind !== 'deny') return tool.execute(toolCallId, params);

      suspendTools(local, decision.code);
      logDenied(ctx, tool.name, decision);
      return appendToolText(
        toolErrorResult(decision.message, decision.code),
        SCOPE_TERMINAL_NOTICE,
      );
    },
  };
}

function logDenied(ctx: ScopeGuardLogContext, toolName: string, decision: DenyDecision): void {
  const behavior = decision.behavior;
  const fields = {
    event: 'scope_guard.denied',
    code: decision.code,
    reason: decision.reason,
    user_id: ctx.userId,
    agent_name: ctx.agentName,
    ...(ctx.threadId !== undefined ? { thread_id: ctx.threadId } : {}),
    tool_name: toolName,
    ...(behavior !== null ? { ontology: behavior.ontologyKey, behavior: behavior.behaviorName } : {}),
    scope_kind: decision.scopeKind,
    scope_size: decision.scopeSize,
  };
  try {
    if (decision.code === 'ONTOLOGY_SCOPE_UNAVAILABLE') ctx.logger.error(fields, decision.message);
    else ctx.logger.warn(fields, decision.message);
  } catch {
    // 日志故障不影响拒绝结果（原则九：可观测性不能反过来制造故障）
  }
}

/**
 * 挂起后的每次工具调用：只记"被拦了几次"（判定字段已由上一条 `denied` 记录）。
 *
 * `attempts` 是兜底阈值的唯一依据：`>1` 即调用 `onExhausted`
 * （软收尾只给一次机会，避免红卡片堆积与无效 token 消耗）。
 */
function logSuspended(
  ctx: ScopeGuardLogContext,
  toolName: string,
  attempts: number,
  code: string,
): void {
  try {
    ctx.logger.warn(
      {
        event: 'scope_guard.suspended',
        code,
        user_id: ctx.userId,
        agent_name: ctx.agentName,
        ...(ctx.threadId !== undefined ? { thread_id: ctx.threadId } : {}),
        tool_name: toolName,
        attempts,
      },
      '权限拒绝后本轮已挂起：工具调用被直接拒绝',
    );
  } catch {
    // 审计写失败不影响主流程
  }
}

/** 端口违约（`check` 抛错）时的兜底记录：这是需修复的缺陷，不是正常的拒绝路径 */
function logEvaluatorError(ctx: ScopeGuardLogContext, toolName: string, err: unknown): void {
  try {
    ctx.logger.error(
      {
        event: 'scope_guard.evaluator_error',
        err,
        user_id: ctx.userId,
        agent_name: ctx.agentName,
        ...(ctx.threadId !== undefined ? { thread_id: ctx.threadId } : {}),
        tool_name: toolName,
      },
      '本体行为权限闸门判定异常，已按安全默认拒绝',
    );
  } catch {
    // 同上：日志故障不得改变结果
  }
}
