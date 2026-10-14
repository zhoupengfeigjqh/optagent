/**
 * 数字人作用域解析（009 FR-023：隔离判定的**唯一实现**）。
 *
 * 一次文件/会话请求的归属数字人 = 服务端"当前选中数字人"（`CurrentAgentStore`，按用户）。
 * 客户端**不能**指定归属（契约 §0）。本模块把"未选中 / 选中但不可用"两类拒绝收敛到一处，
 * 供 `routes/{files,files-put,threads,chat,produced}.ts` 共用——此前这些判定分散在
 * 各路由（`files.ts` 的 `currentAgentFor`、`threads.ts`/`chat.ts` 各自的 `currentAgent` 判空）。
 *
 * 两类拒绝（契约 `specs/009-agent-data-isolation/contracts/api-delta.md` §1）：
 * - 未选中 → `409 AGENT_NOT_SELECTED`（沿用既有码与文案，各路由文案可覆写以保持一致）
 * - 已选中但该数字人对本用户**不可用**（配置目录不存在或配置损坏）→ `409 AGENT_NOT_AVAILABLE`
 *   **新增码**：典型场景是数字人已被平台移除并部署，而客户端仍停在它（陈旧上下文）。
 *
 * 判定开销：可用性复用既有 `loadAgentConfig`（同步读几个小文件），**不遍历用户目录**
 * （plan §性能目标）；仅在命中"已选中"分支时才读盘。
 */
import { agentDir } from './dirs.js';
import type { AppContext } from '../context.js';
import { AgentConfigError, loadAgentConfig } from './agent-instance.js';

/** 作用域解析结果：归属二元组 */
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

/** 未选中数字人的缺省文案（既有文案见各路由；可覆写以保持既有契约逐字不变） */
export const AGENT_NOT_SELECTED_MESSAGE = '请先选定数字人';

export interface ResolveScopeOptions {
  /**
   * 未选中时的可读文案。各路由沿用**各自既有的**文案（如"请先选定数字人再创建对话"），
   * 判定逻辑同源、仅呈现不同——避免把一次收敛做成文案变更。
   */
  notSelectedMessage?: string;
  /** 请求线索（如 `GET /api/files/list`）：只入日志，进不了响应，便于运维定位 */
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
