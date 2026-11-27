import type { WorkspaceDir, WorkspaceSpace } from '../api/types'
import { isFlatSpace, spaceSubDirs } from './space'

/**
 * 引导文案（FR-019）。
 *
 * MUST 是界面固定常量：不取自数字人配置、模型输出或服务端文本，否则"提示与事实不符"时
 * 用户无从判断是数据问题还是配置问题。
 */
export const EMPTY_DATA_HINT_TEXT = '当前您还没有准备数据，请点击 “+” 上传吧。'

export function needsDataUpload(spaces: readonly WorkspaceSpace[] | null | undefined): boolean {
  if (!spaces || spaces.length === 0) return false

  // 「数据准备」是唯一带二级目录清单的空间：扁平空间（共享 / 临时）的 dirs 只有自身一项
  const prepDirs: readonly WorkspaceDir[] = spaces
    .filter((space) => !isFlatSpace(space))
    .flatMap((space) => spaceSubDirs(space))

  if (prepDirs.length === 0) return false

  if (prepDirs.some((dir) => typeof dir.predefined !== 'boolean')) return false

  const candidates = prepDirs.filter((dir) => dir.predefined === false)

  if (candidates.length === 0) return false

  return candidates.every((dir) => dir.files.length === 0)
}
