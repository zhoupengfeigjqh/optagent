/**
 * 空数据新手引导的判定（014）。
 *
 * 职责边界：只做"给定文件空间清单，是否需要提示上传"的纯计算，不持有状态、不发起请求。
 * 状态机在 `composables/useEmptyDataHint.ts`，本文件可被单测直接调用。
 *
 * 判定口径（`specs/014-chat-onboarding-hint/spec.md` FR-007~FR-009）：
 * - 「数据准备」用**结构特征**识别（唯一拥有二级目录清单的空间），不硬编码空间名；
 * - 只有**非预定义**二级目录参与判定，预定义目录（算法规则）里有没有文件都不影响；
 * - 没有任何非预定义目录 ⇒ 不提示（避免把用户引向规则目录）；
 * - 目录的 `predefined` 标记由接口下发，前端不硬编码目录名（宪章原则七）。
 */
import type { WorkspaceDir, WorkspaceSpace } from '../api/types'
import { isFlatSpace, spaceSubDirs } from './space'

/**
 * 引导文案（FR-019）。
 *
 * MUST 是界面固定常量：不取自数字人配置、模型输出或服务端文本，否则"提示与事实不符"时
 * 用户无从判断是数据问题还是配置问题。
 */
export const EMPTY_DATA_HINT_TEXT = '当前您还没有准备数据，请点击 “+” 上传吧。'

/**
 * 是否需要提示用户上传数据。
 *
 * @param spaces 当前数字人的文件空间清单（未加载 / 加载失败时传空数组即可）
 */
export function needsDataUpload(spaces: readonly WorkspaceSpace[] | null | undefined): boolean {
  if (!spaces || spaces.length === 0) return false

  // 「数据准备」是唯一带二级目录清单的空间：扁平空间（共享 / 临时）的 dirs 只有自身一项
  const prepDirs: readonly WorkspaceDir[] = spaces
    .filter((space) => !isFlatSpace(space))
    .flatMap((space) => spaceSubDirs(space))

  if (prepDirs.length === 0) return false

  // 字段缺失（旧服务端 / 半部署）按"不满足"处理：宁可不提示，也不误判成"没有准备数据"
  if (prepDirs.some((dir) => typeof dir.predefined !== 'boolean')) return false

  const candidates = prepDirs.filter((dir) => dir.predefined === false)

  // 只剩预定义目录：没有"可放业务数据的目录"，提示会把用户引向规则目录
  if (candidates.length === 0) return false

  return candidates.every((dir) => dir.files.length === 0)
}
