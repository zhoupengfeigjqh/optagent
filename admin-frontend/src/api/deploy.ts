/**
 * 部署 API（`contracts/admin-api.md` §6.5~§6.8、§7.1、§7.2）。
 */
import { http } from './http'
import type {
  AnomalyResponse,
  DeployHistoryItem,
  DeployResult,
  DeployValidateResult,
  ManifestEntry,
  ReferencesResponse,
} from './types'

/** 只读预检（`FR-027`）：让管理员在真正部署前看到**全部**错误项 */
export function validateDeploy(userIds?: string[]): Promise<DeployValidateResult> {
  return http.post<DeployValidateResult>('/api/admin/deploy/validate', userIds ? { user_ids: userIds } : {})
}

/** 部署生效（`FR-026`）；校验不通过时后端返回 409 + `details.errors` */
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
  return http.get<{ items: DeployHistoryItem[]; truncated: boolean }>('/api/admin/deploy/history', { limit })
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

export function fetchManifest(): Promise<{ items: ManifestEntry[]; total: number }> {
  return http.get<{ items: ManifestEntry[]; total: number }>('/api/admin/deploy/manifest')
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

/** `§7.2` 全局异常项汇总（`FR-055`、`SC-016`）：一次视图内可见全部受影响数字人 */
export function fetchAnomalies(limit = 50): Promise<AnomalyResponse> {
  return http.get<AnomalyResponse>('/api/admin/anomalies', { limit })
}
