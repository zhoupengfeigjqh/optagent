/**
 * 本体行为权限闸门的**唯一** AgentTool 包装器（020）。
 *
 * 与 `tool-intercept.ts`（HITL）同形：只做"执行前拦住/放行"，不含任何业务知识。
 *
 * 解耦红线（本文件 MUST 守住）：
 * - 不出现具体工具名、MCP 服务名、本体名、yaml 字段名；
 * - 不解析文件、不判规则——所有判定来自 `domain/scope-guard` 的端口；
 * - 拒绝不走 `throw`，复用 `domain/tool-error.js` 的统一失败标记（卡片标红、模型可读）。
 *
 * 顺序约定（`FR-002`）：本包装器在装配末端套在**最外层**，因此权限判定天然先于
 * HITL 确认——被拒的调用不会向用户弹出确认框。
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';

import type { ScopeDecision, ScopeGuardPort } from '../domain/scope-guard/index.js';
import {
  SCOPE_GUARD_FALLBACK_CODE,
  SCOPE_GUARD_FALLBACK_MESSAGE,
} from '../domain/scope-guard/index.js';
import { toolErrorResult } from '../domain/tool-error.js';

/** 拒绝日志需要的归属上下文（装配层提供） */
export interface ScopeGuardLogContext {
  logger: Logger;
  userId: string;
  agentName: string;
  threadId?: string;
}

type DenyDecision = Extract<ScopeDecision, { kind: 'deny' }>;

/** 逐工具包装（每工具仅一次）；空数组原样返回 */
export function guardTools(
  tools: AgentTool[],
  guard: ScopeGuardPort,
  ctx: ScopeGuardLogContext,
): AgentTool[] {
  return tools.map((tool) => wrapToolWithScopeGuard(tool, guard, ctx));
}

export function wrapToolWithScopeGuard(
  tool: AgentTool,
  guard: ScopeGuardPort,
  ctx: ScopeGuardLogContext,
): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      let decision: ScopeDecision;
      try {
        decision = guard.check(tool.name);
      } catch (err) {
        // 端口契约是"永不抛"；这里再兜一层，保证实现违约时也是"拒绝"而不是"执行"
        logEvaluatorError(ctx, tool.name, err);
        return toolErrorResult(SCOPE_GUARD_FALLBACK_MESSAGE, SCOPE_GUARD_FALLBACK_CODE);
      }
      if (decision.kind !== 'deny') return tool.execute(toolCallId, params);
      logDenied(ctx, tool.name, decision);
      return toolErrorResult(decision.message, decision.code);
    },
  };
}

/** 每次拒绝一条结构化记录（契约 §5.1）；不含入参、不含 `scope` 名单 */
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
