import type { SkillOrigin } from './onto-market'

export interface SkillListItem {
  name: string
  display_name?: string | null
  description: string
  installed_at: string
  updated_at: string
  source: string
  origin?: SkillOrigin | null
}

export interface SkillDetail {
  name: string
  display_name?: string | null
  description: string
  content: string
  content_hash: string
  files: Array<{ path: string; size: number }>
  source: string
  origin?: SkillOrigin | null
  installed_at: string
  updated_at: string
  revision: number
}

export interface SkillFileContent {
  name: string
  path: string
  size: number
  binary: boolean
  /** 超出上限（256KB）时为 true，`content` 只含前 256KB */
  truncated: boolean
  content: string | null
  hash: string
  editable: boolean
}

export interface SkillFileSaved {
  name: string
  path: string
  size: number
  hash: string
  updated_at: string
  revision: number
}

export interface SkillInstallResult {
  name: string
  display_name?: string | null
  description: string
  files: Array<{ path: string; size: number }>
  installed_at: string
  overwritten: boolean
}
