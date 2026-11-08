/**
 * 工具卡片正文下方的**一行截断说明**（2026-11-07，2026-11-08 简化）。
 *
 * 抽成纯函数的理由（宪章原则二）：组件里"该说哪句话"与"怎么渲染"是两件事，
 * 而这段判断值得穷举单测——放在组件里只能靠 DOM 断言间接覆盖。
 *
 * 卡片只展示记录里的 `inline_content`（超阈值时是截断版），**不拉取副本**，
 * 因此这里只剩"要不要说明这是截断版"一件事：
 * - 未截断 → 不提示（正文就是全文）；
 * - 内置工具（无副本）→ 明说完整内容没保存、可让助手重新读取；
 * - 外部来源（有副本）→ 说明只显示前一部分，并给出副本体积（在哪可让助手 `read_file` 取）。
 */
import { formatBytes } from './format'
import type { ToolCallItem } from './tool-calls'

/** 无提示（模板据此渲染"无结果内容"兜底） */
export const NO_HINT = ''

/**
 * 取该条结果的截断说明；`''` = 不需要提示。
 *
 * 两种文案的差别是**磁盘上有没有那份完整正文**——这决定了用户/助手下一步能做什么。
 */
export function resultHint(item: ToolCallItem): string {
  if (item.truncated !== true) return NO_HINT
  if (item.artifactSize === undefined) {
    // 内置工具：磁盘上没有副本，只能让助手按更小范围重取
    return '结果过大，仅保留了前一部分（完整内容未保存，可让助手重新读取）'
  }
  return `结果过大，仅显示前一部分（完整正文 ${formatBytes(item.artifactSize)} 存于临时空间，可让助手读取）`
}
