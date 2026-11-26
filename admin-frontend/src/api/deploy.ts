import { http } from './http'
import type {
  AnomalyResponse,
  DeployHistoryItem,
  DeployResult,
  DeployValidateResult,
  ManifestEntry,
  ReferencesResponse,
} from './types'

export function validateDeploy(userIds?: string[]): Promise<DeployValidateResult> {
  return http.post<DeployValidateResult>(
    '/api/admin/deploy/validate',
    userIds ? { user_ids: userIds } : {},
  )
}

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

export function withdrawDeploy(
  userId: string,
  revision: number,
): Promise<{ user_id: string; withdrawn: string[] }> {
  return http.post<{ user_id: string; withdrawn: string[] }>('/api/admin/deploy/withdraw', {
    user_id: userId,
    revision,
  })
}

export function fetchManifest(): Promise<{
  items: ManifestEntry[]
  total: number
  revision: number
}> {
  return http.get<{ items: ManifestEntry[]; total: number; revision: number }>(
    '/api/admin/deploy/manifest',
  )
}

export function fetchReferences(
  targetType: 'builtin_tool' | 'mcp_service' | 'skill' | 'agent' | 'user',
  targetName: string,
): Promise<ReferencesResponse> {
  return http.get<ReferencesResponse>('/api/admin/references', {
    target_type: targetType,
    target_name: targetName,
  })
}

export function fetchAnomalies(limit = 50): Promise<AnomalyResponse> {
  return http.get<AnomalyResponse>('/api/admin/anomalies', { limit })
}
