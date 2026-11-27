import { http } from './http'
import type { DeployResult, WithdrawResult } from './types'

/**
 * 部署（契约 §6.5）：把 `user_ids` 各自**已授权**的数字人写入运行环境。
 *
 * 2026-11-27 起部署只有这一个入口——用户管理表格的行内「部署」按钮，一次一个用户。
 * 语义是"整体覆盖"：该用户运行环境 `agents/` 下的内容以本次授权清单为准，
 * 取消授权的数字人目录会被清掉，文件空间（`user-data/**`）不动。
 *
 * `revision` 是平台配置版本号（`GET /api/admin/deploy/manifest`），变更后即失效 →
 * 409 `ADM_CONFIG_REVISION_CONFLICT`，调用方须重新取版本再部署。
 */
export function deployUsers(userIds: string[], revision: number): Promise<DeployResult> {
  return http.post<DeployResult>('/api/admin/deploy', { user_ids: userIds, revision })
}

/**
 * 停止（撤回部署，契约 §6.9）：清空该用户在运行环境中的**全部**数字人副本。
 *
 * - 只影响运行环境：授权（`users.agents[]`）与文件空间（`user-data/**`）保留；
 * - 撤回后 `my-agents` 为空 → 该用户立即无法使用，重新部署即可恢复；
 * - `revision` 同部署，版本过期 → 409 `ADM_CONFIG_REVISION_CONFLICT`。
 */
export function withdrawUser(userId: string, revision: number): Promise<WithdrawResult> {
  return http.post<WithdrawResult>('/api/admin/deploy/withdraw', { user_id: userId, revision })
}
