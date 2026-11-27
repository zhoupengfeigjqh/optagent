import { http } from './http'
import type { ReferencesResponse } from './types'

/**
 * 引用关系查询（契约 §7.1）。
 *
 * SKILL 上传覆盖 / 查看时用它列出"哪些数字人引用了这个对象"，
 * 供管理员在破坏性操作前确认影响面。
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
