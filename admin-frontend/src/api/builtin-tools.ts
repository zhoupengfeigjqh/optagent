/**
 * 内置工具目录 API（`contracts/admin-api.md` §2.1）。
 *
 * 目录来源为**运行环境**（`FR-011`）；平台只做只读投影。
 * `description_template` MUST 保持占位符模板形态（`FR-012`、`SC-014`），
 * 因此前端**不做任何替换**，直接呈现原文。
 */
import { http } from './http'
import type { BuiltinToolListResponse } from './types'

export function listBuiltinTools(limit = 200): Promise<BuiltinToolListResponse> {
  return http.get<BuiltinToolListResponse>('/api/admin/builtin-tools', { limit })
}
