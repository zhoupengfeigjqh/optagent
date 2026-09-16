/**
 * SKILL API（`contracts/admin-api.md` §4.1~§4.5）。
 *
 * 2026-09-16 产品决定：**全部文件可编辑**（`SKILL.md` 与 `references/` 等附件），
 * 编辑走 `PUT .../file` 并携带读到的内容哈希作乐观锁。
 */
import { http } from './http'
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

/** 读取技能内单个文件：SKILL.md、references/、scripts/ 等 */
export function fetchSkillFile(name: string, path: string): Promise<SkillFileContent> {
  return http.get<SkillFileContent>(`/api/admin/skills/${encodeURIComponent(name)}/file`, { path })
}

/**
 * 保存技能内单个文件。
 *
 * `baseHash` 是**读取时拿到的哈希**：服务端据此判断内容是否已被他处修改，
 * 不符即 409（`ADM_CONFIG_REVISION_CONFLICT`）且不执行保存。
 */
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

/**
 * 上传 ZIP 安装（`FR-037`）。
 * `overwrite: true` 表示名称冲突时**显式选择覆盖**（`FR-040`）。
 */
export function installSkill(file: File, overwrite: boolean): Promise<SkillInstallResult> {
  const form = new FormData()
  form.append('file', file, file.name)
  if (overwrite) form.append('overwrite', 'true')
  return http.post<SkillInstallResult>('/api/admin/skills/install', form)
}

export function deleteSkill(name: string): Promise<void> {
  return http.del<void>(`/api/admin/skills/${encodeURIComponent(name)}`)
}
