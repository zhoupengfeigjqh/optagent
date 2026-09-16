/**
 * 平台与配置 API（`contracts/admin-api.md` §1.1~§1.4）。
 */
import { http } from './http'
import type { PlatformHealth, PlatformSettings, RuntimeFormOption } from './types'

export function fetchHealth(): Promise<PlatformHealth> {
  return http.get<PlatformHealth>('/api/admin/platform/health')
}

export function fetchSettings(): Promise<PlatformSettings> {
  return http.get<PlatformSettings>('/api/admin/platform/settings')
}

/** 可选运行形态由服务端提供，前端 MUST NOT 硬编码（原则七） */
export function fetchRuntimeForms(): Promise<{ items: RuntimeFormOption[] }> {
  return http.get<{ items: RuntimeFormOption[] }>('/api/admin/platform/runtime-forms')
}

/** 切换目标运行形态（`FR-057`）；属破坏性操作，调用方 MUST 先二次确认 */
export function saveSettings(
  targetRuntimeForm: string,
  revision: number,
): Promise<PlatformSettings & { deploy_required: boolean }> {
  return http.put<PlatformSettings & { deploy_required: boolean }>('/api/admin/platform/settings', {
    target_runtime_form: targetRuntimeForm,
    revision,
  })
}
