import { http } from './http'
import type { PlatformHealth } from './types'

export function fetchHealth(): Promise<PlatformHealth> {
  return http.get<PlatformHealth>('/api/admin/platform/health')
}
