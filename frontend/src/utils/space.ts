
import type { WorkspaceDir, WorkspaceSpace } from '../api/types'

/** 是否扁平空间（2026-11-18 / 025 后仅临时空间）：空间自身即目标目录，展开后直接出文件。 */
export function isFlatSpace(space: WorkspaceSpace): boolean {
  return space.dirs.length === 1 && space.dirs[0]?.dir === space.name
}

export function spaceSubDirs(space: WorkspaceSpace): WorkspaceDir[] {
  return isFlatSpace(space) ? [] : space.dirs
}

export function spaceFileCount(space: WorkspaceSpace): number {
  return space.dirs.reduce((total, dir) => total + dir.files.length, 0)
}
