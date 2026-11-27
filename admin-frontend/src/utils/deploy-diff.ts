import type { DeployManifestDiffEntry } from '../api/types'

export function diffText(diff: DeployManifestDiffEntry): string {
  const target = diff.target ? ` / ${diff.target}` : ''
  return `${diff.user_id}${target}：${diff.detail || diff.kind || ''}`
}
