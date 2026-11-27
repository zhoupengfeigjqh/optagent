import { http } from './http'
import type { BuiltinToolListResponse } from './types'

export function listBuiltinTools(limit = 200): Promise<BuiltinToolListResponse> {
  return http.get<BuiltinToolListResponse>('/api/admin/builtin-tools', { limit })
}
