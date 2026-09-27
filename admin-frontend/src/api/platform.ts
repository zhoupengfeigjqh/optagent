/**
 * 平台健康 API（`contracts/admin-api.md` §1.1）。
 *
 * **2026-09-27**：§1.2~§1.4（平台设置与运行形态）随概念下架，
 * 本模块只剩健康检查一条只读接口。
 */
import { http } from './http'
import type { PlatformHealth } from './types'

export function fetchHealth(): Promise<PlatformHealth> {
  return http.get<PlatformHealth>('/api/admin/platform/health')
}
