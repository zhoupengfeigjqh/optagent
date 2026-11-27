import { http } from './http'
import type { ManifestEntry } from './types'

/**
 * 部署清单（契约 §6.8）。
 *
 * 自 2026-11-27「数字人部署」功能区下架后，本端点只保留两个用途：
 * 读清单账本（谁部署了什么）与取平台配置版本号 `revision`——用户管理侧的
 * 账户增改用它做乐观锁，冲突即 `ADM_CONFIG_REVISION_CONFLICT`。
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
