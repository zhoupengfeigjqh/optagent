import { agentDir } from './dirs.js';
import type { AppContext } from '../context.js';
import { AgentConfigError, loadAgentConfig } from './agent-instance.js';

export interface AgentScope {
  userId: string;
  agentName: string;
}

/** 作用域错误码（与全局错误映射表登记的码一致，MUST NOT 落成 500） */
export type AgentScopeErrorCode = 'AGENT_NOT_SELECTED' | 'AGENT_NOT_AVAILABLE';

export class AgentScopeError extends Error {
  readonly code: AgentScopeErrorCode;
  readonly statusCode = 409;
  constructor(code: AgentScopeErrorCode, message: string) {
    super(message);
    this.name = 'AgentScopeError';
    this.code = code;
  }
}

export const AGENT_NOT_SELECTED_MESSAGE = '请先选定数字人';

export interface ResolveScopeOptions {
  /**
   * 未选中时的可读文案。各路由沿用**各自既有的**文案（如"请先选定数字人再创建对话"），
   * 判定逻辑同源、仅呈现不同——避免把一次收敛做成文案变更。
   */
  notSelectedMessage?: string;
  route?: string;
}

/**
 * 解析请求归属数字人；不可用即抛 `AgentScopeError`（上层转 409）。
 *
 * 不可用时**不自动清空**选中态（FR-032）：选中态留在内存里，前端据此提示
 * "该数字人已不可用，请重新选择"，用户显式重选后才更新。
 */
export function resolveAgentScope(
  ctx: AppContext,
  userId: string,
  opts: ResolveScopeOptions = {},
): AgentScope {
  const selected = ctx.currentAgent.current(userId);
  if (!selected) {
    throw new AgentScopeError(
      'AGENT_NOT_SELECTED',
      opts.notSelectedMessage ?? AGENT_NOT_SELECTED_MESSAGE,
    );
  }
  const { agentName } = selected;
  const reason = unavailableReason(ctx.config.optAgentRoot, userId, agentName);
  if (reason) {
    // 降级原因 MUST 可观测（FR-051）：含用户标识、数字人标识与请求线索
    ctx.loggers.logger.warn(
      {
        alert: false,
        event: 'agent.scope.unavailable',
        user_id: userId,
        agent_name: agentName,
        route: opts.route ?? null,
        reason,
      },
      `数字人 ${agentName} 对本用户不可用（${reason}）：拒绝该请求`,
    );
    throw new AgentScopeError(
      'AGENT_NOT_AVAILABLE',
      `该数字人已不可用，请重新选择（${agentName}）`,
    );
  }
  return { userId, agentName };
}

/**
 * 数字人可用性判据（唯一实现）：配置目录存在且能**完整**加载。
 *
 * 只看目录存在不够——配置损坏（SOUL/TOOL/MCP 缺项或非法）同样不可用，
 * 且此时按部分配置运行等于静默降级（FR-050）。返回 `undefined` = 可用；
 * 否则返回人可读的原因（供日志）。
 */
export function unavailableReason(
  optAgentRoot: string,
  userId: string,
  agentName: string,
): string | undefined {
  try {
    loadAgentConfig(agentDir(optAgentRoot, userId, agentName));
    return undefined;
  } catch (err) {
    return err instanceof AgentConfigError ? err.message : `配置读取失败：${String(err)}`;
  }
}
