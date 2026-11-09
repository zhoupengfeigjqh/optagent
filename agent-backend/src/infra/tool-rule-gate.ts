/**
 * 本体行为规则闸门的**唯一** AgentTool 包装器（021）。
 *
 * 与 `tool-scope-guard.ts`（020）同形：只做"执行前拦住/放行 + 执行后追加"，
 * 不含任何业务知识。
 *
 * 解耦红线（本文件 MUST 守住）：
 * - 不出现具体工具名、MCP 服务名、本体名、yaml 字段名；
 * - 不解析文件、不判规则——所有判定来自 `domain/rule-gate` 的端口；
 * - 暂停 / 拒绝都不走 `throw`，复用 `domain/tool-error.js` 的统一失败标记。
 *
 * 顺序约定：本包装器在 020 权限闸门**内侧**（`guardTools(ruleGateTools(tools))`），
 * 因此被权限闸门拒绝的调用不会进入这里——既不判定也不记录（`FR-009`）。
 *
 * 拒绝后的本轮语义（2026-11-09，与 020 对齐）：**软收尾**。
 * 一旦拒绝即挂起本轮全部工具（共享 `domain/tool-suspension.ts` 的状态），
 * 拒绝卡片给出「结论 + 明细 + 终局指令」，模型据此向用户总结后正常 `done`，
 * MUST NOT 再制造 error 失败轮。配置类拒绝仍记 `error` 级日志 + `alert`。
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';

import {
  RULE_DENIED_CODE,
  RULE_FUNCTIONS_MISSING_CODE,
  denyCardBody,
  type FunctionRecord,
  type PostHintResult,
  type PrepareResult,
  type RuleDiagnosis,
  type RuleGatePort,
} from '../domain/rule-gate/index.js';
import { appendToolText, readToolError, toolErrorResult } from '../domain/tool-error.js';
import {
  SUSPENDED_MESSAGE,
  interceptSuspended,
  suspendTools,
  type ToolSuspension,
} from '../domain/tool-suspension.js';

/** 包装器需要的上下文（全部由装配层提供） */
export interface RuleGateContext {
  gate: RuleGatePort;
  /** 本轮函数记录（每轮新建） */
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

      const prepared = prepareSafely(ctx, tool.name);

      // 2. 暂停：不执行，返回失败结果（本轮继续，模型可补调后重试）
      if (prepared.kind === 'pause') {
        logEvent(ctx, 'info', 'rule_gate.paused', {
          tool_name: tool.name,
          ...diagnosisFields(prepared.diagnosis),
          ...(prepared.diagnosis?.missingFunctions !== undefined
            ? { missing_functions: prepared.diagnosis.missingFunctions }
            : {}),
        });
        return toolErrorResult(prepared.message, RULE_FUNCTIONS_MISSING_CODE);
      }

      // 3. 拒绝：不执行、挂起本轮，卡片给出「结论 + 明细 + 终局指令」（软收尾）
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
        if (prepared.kind === 'function') ctx.record.add(tool.name, null);
        throw err;
      }

      // 4. 函数角色：成败都记（失败标记 → null），结果原样返回
      if (prepared.kind === 'function') {
        ctx.record.add(tool.name, isFailed(result) ? null : result);
        return result;
      }

      // 5. 行为角色：仅成功时校验后置规则
      if (isFailed(result)) return result;

      const hint = postHintSafely(ctx, tool.name);
      if (hint === null) return result;

      if (hint.kind === 'blocked') {
        logEvent(ctx, 'error', 'rule_gate.blocked', {
          tool_name: tool.name,
          ...diagnosisFields(hint.diagnosis),
          phase: 'post',
          executed: true,
          unregistered_functions: hint.diagnosis?.unregisteredFunctions ?? [],
        });
        // 业务结果**完整保留**（不追加后置规则提示），只在其后追加阻断说明与终局指令：
        // 软收尾下模型必须知道"业务已写入、但本轮不能再调工具"。
        suspendTools(ctx.suspension, RULE_DENIED_CODE);
        return appendToolText(result, denyCardBody([hint.message, ...hint.details]));
      }

      logEvent(ctx, 'info', 'rule_gate.posted', {
        tool_name: tool.name,
        ...diagnosisFields(hint.diagnosis),
      });
      // 追加一个文本块；原始 `content` 的顺序与内容逐字保留（`FR-029` / `FR-031`）
      return appendToolText(result, hint.text);
    },
  };
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

/** 后置判定异常不得改变已成功的业务结果：降级为"不追加" */
function postHintSafely(ctx: RuleGateContext, toolName: string): PostHintResult {
  try {
    return ctx.gate.postHint({
      toolName,
      record: ctx.record,
      available: ctx.availableNames,
    });
  } catch {
    return null;
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
