/**
 * 三空间结构判定（纯函数，全局唯一来源）
 *
 * 后端 `GET /api/files/workspace` 下发的每个空间都带 `dirs`：
 * - 数据准备：`dirs` 为 scenario 定义的**子目录清单**（二级）
 * - 共享空间 / 临时空间：`dirs` **仅含空间自身一项**（扁平空间）
 *
 * 右侧文件空间树（`WorkspaceSpaceTree`）与 `@` 引用面板（`useFileMention`）
 * 都按同一规则分层，故判定集中在此，避免两处各写一套。
 */

import type { WorkspaceDir, WorkspaceSpace } from '../api/types'

/** 是否扁平空间（共享空间 / 临时空间）：空间自身即目标目录，展开后直接出文件。 */
export function isFlatSpace(space: WorkspaceSpace): boolean {
  return space.dirs.length === 1 && space.dirs[0]?.dir === space.name
}

/** 空间下的二级子目录；扁平空间返回空数组（不下钻，直接出文件）。 */
export function spaceSubDirs(space: WorkspaceSpace): WorkspaceDir[] {
  return isFlatSpace(space) ? [] : space.dirs
}

/** 空间内文件总数（扁平空间取其自身目录的文件数，数据准备为其子目录文件数之和）。 */
export function spaceFileCount(space: WorkspaceSpace): number {
  return space.dirs.reduce((total, dir) => total + dir.files.length, 0)
}
