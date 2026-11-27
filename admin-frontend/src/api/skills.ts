import { http } from './http'
import type { OntoMarketListing, OntoMarketUpdateResult } from './onto-market'
import type {
  Paged,
  SkillDetail,
  SkillFileContent,
  SkillFileSaved,
  SkillInstallResult,
  SkillListItem,
} from './types'

export function listSkills(page = 1): Promise<Paged<SkillListItem>> {
  return http.get<Paged<SkillListItem>>('/api/admin/skills', { page })
}

export function getSkill(name: string): Promise<SkillDetail> {
  return http.get<SkillDetail>(`/api/admin/skills/${encodeURIComponent(name)}`)
}

export function fetchSkillFile(name: string, path: string): Promise<SkillFileContent> {
  return http.get<SkillFileContent>(`/api/admin/skills/${encodeURIComponent(name)}/file`, { path })
}

export function saveSkillFile(
  name: string,
  path: string,
  content: string,
  baseHash: string,
): Promise<SkillFileSaved> {
  return http.put<SkillFileSaved>(`/api/admin/skills/${encodeURIComponent(name)}/file`, {
    path,
    content,
    base_hash: baseHash,
  })
}

export function installSkill(file: File, overwrite: boolean): Promise<SkillInstallResult> {
  const form = new FormData()
  form.append('file', file, file.name)
  if (overwrite) form.append('overwrite', 'true')
  return http.post<SkillInstallResult>('/api/admin/skills/install', form)
}

export function deleteSkill(name: string): Promise<void> {
  return http.del<void>(`/api/admin/skills/${encodeURIComponent(name)}`)
}

export function fetchOntoMarket(): Promise<OntoMarketListing> {
  return http.get<OntoMarketListing>('/api/admin/skills/onto-market')
}

export function installOntoMarketSkill(
  scenario: string,
  ontology: string,
  skill: string,
): Promise<SkillInstallResult> {
  return http.post<SkillInstallResult>('/api/admin/skills/onto-market/install', {
    scenario,
    ontology,
    skill,
  })
}

/**
 * 从本体市场更新（§4.8）：整包原子替换一份已从市场导入的技能。
 *
 * 库内版本被人工修改过时服务端返回 409 `ADM_SKILL_MODIFIED`；
 * `confirm: true` 表示管理员已确认丢弃本地修改。
 */
export function updateOntoMarketSkill(
  scenario: string,
  ontology: string,
  skill: string,
  confirm = false,
): Promise<OntoMarketUpdateResult> {
  return http.post<OntoMarketUpdateResult>('/api/admin/skills/onto-market/update', {
    scenario,
    ontology,
    skill,
    confirm,
  })
}
