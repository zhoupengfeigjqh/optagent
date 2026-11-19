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
 * 流式期「已有终态、正文却还没到」的说明（2026-11-18）。
 *
 * 措辞刻意只承诺**时间点**（本轮结束后），不承诺"一定有内容"——工具真返回空正文时，
 * 轮末会回落成「无结果内容」，两者不冲突。
 */
export const LIVE_PENDING_HINT = '结果将在本轮结束后可查看'

/**
 * 取该条**无正文**时的说明；`NO_HINT` = 交由模板兜底「无结果内容」。
 *
 * 为什么需要它：流式期 SSE 的 `tool_call_end` 只带 `{call_id, status}`（见
 * `agent-backend/src/domain/run-consume.ts`），正文只在轮末落盘并随历史下发。于是"已完成"
 * 的卡片在流式期必然可展开、必然为空 —— 此时说「无结果内容」等于谎报"工具没有结果"。
 *
 * 三种情形**保持原样**（这是本函数唯一的边界）：
 * - 有截断说明时以截断说明为准（`resultHint` 已负责，这里不抢它的位置）；
 * - 历史态（`live=false`）：正文确实为空，就是「无结果内容」；
 * - 工具本身报错（`status='error'`）：空正文即失败本身，不是"还没送到"，别误导。
 */
export function emptyBodyHint(item: ToolCallItem, live: boolean): string {
  if (item.truncated === true) return NO_HINT
  if (!live) return NO_HINT
  if (item.status === 'error') return NO_HINT
  return LIVE_PENDING_HINT
}

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
