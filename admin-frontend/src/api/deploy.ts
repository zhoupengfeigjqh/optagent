/**
 * 部署 API（`contracts/admin-api.md` §6.6~§6.9、§7.1）。
 *
 * **2026-11-23**：部署前预检（`validateDeploy`）与全局异常项汇总（`fetchAnomalies`）
 * 随功能下架删除——设计态在保存时已校验，部署直接写入。
 */
import { http } from './http'
import type { DeployHistoryItem, DeployResult, ManifestEntry, ReferencesResponse } from './types'

/** 部署生效（`FR-026`）：逐用户整体覆盖写入，某用户失败只跳过该用户 */
export function deploy(userIds: string[] | undefined, revision: number): Promise<DeployResult> {
  return http.post<DeployResult>('/api/admin/deploy', {
    ...(userIds && userIds.length > 0 ? { user_ids: userIds } : {}),
    revision,
  })
}

/**
 * 部署历史一次拉取的条数：取服务端上限 100（`FR-006` 有界返回）。
 *
 * 历史是**持续追加**的日志，服务端只按"最近 N 条"返回；界面在这 N 条内按页呈现
 * （每页 5 条，见 `DeployHistoryList.vue`）。取上限而不是默认的 20——
 * 否则翻两页就到底，会被误读成"历史只有 20 条"。
 */
export const DEPLOY_HISTORY_FETCH_LIMIT = 100

export function fetchDeployHistory(
  limit = DEPLOY_HISTORY_FETCH_LIMIT,
): Promise<{ items: DeployHistoryItem[]; truncated: boolean }> {
  return http.get<{ items: DeployHistoryItem[]; truncated: boolean }>('/api/admin/deploy/history', {
    limit,
  })
}

/**
 * `§6.9` 撤回部署：清空该用户在**运行环境**中的数字人目录（用户卡片上的「撤回」）。
 *
 * 平台侧关联与用户文件空间保留——这些数字人随即失去能力，需要时重新部署即可恢复。
 */
export function withdrawDeploy(
  userId: string,
  revision: number,
): Promise<{ user_id: string; withdrawn: string[] }> {
  return http.post<{ user_id: string; withdrawn: string[] }>('/api/admin/deploy/withdraw', {
    user_id: userId,
    revision,
  })
}

/**
 * 部署清单（§6.8）。
 *
 * 响应同时带平台设计态的当前 `revision`——部署接口需要乐观锁版本，
 * 而「目标运行形态」下架后不再有 `/platform/settings` 作为版本来源（2026-09-27）。
 */
export function fetchManifest(): Promise<{
  items: ManifestEntry[]
  total: number
  revision: number
}> {
  return http.get<{ items: ManifestEntry[]; total: number; revision: number }>(
    '/api/admin/deploy/manifest',
  )
}

/**
 * `§7.1` 引用关系查询 —— **仅供破坏性操作的确认环节调用**。
 * 界面 MUST 在管理员**触发删除/关闭之后**才调用本接口（规格关键实体「引用关系」）。
 */
export function fetchReferences(
  targetType: 'builtin_tool' | 'mcp_service' | 'skill' | 'agent' | 'user',
  targetName: string,
): Promise<ReferencesResponse> {
  return http.get<ReferencesResponse>('/api/admin/references', {
    target_type: targetType,
    target_name: targetName,
  })
}
