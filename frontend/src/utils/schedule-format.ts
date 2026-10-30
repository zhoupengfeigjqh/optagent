/**
 * 定时任务展示格式化（015，纯函数）
 *
 * 只做"数据 → 中文文案"的映射，不含任何状态与请求。时间格式化**复用**
 * `utils/format.ts` 的 `formatTimestamp`（全站唯一实现，宪章原则二）——
 * 本文件只在它之上补"秒级 + 占位符 `—`"这一层口径。
 *
 * 为什么把文案集中在这里：任务表格、运行记录弹窗、状态圆点三处都要显示同一批文案，
 * 各写一份必然出现"表格说已跳过、弹窗说跳过"这种同义词漂移。
 */

import type { ScheduleRunReason, ScheduleRunResult, ScheduledTask } from '../api/types'
import { formatTimestamp } from './format'

/** 表格占位符：固定格子不留白（与 `formatBytes` 的 `'—'` 口径一致） */
const PLACEHOLDER = '—'

/** 时刻 → 本地 `YYYY-MM-DD HH:mm:ss`；`null` / 非法 → `—`。 */
export function formatDateTime(iso: string | null | undefined): string {
  return formatTimestamp(iso, { withSeconds: true, fallback: PLACEHOLDER })
}

/**
 * 执行频率 → `每 N 秒 / 分钟 / 小时 / 天`。
 *
 * 取**最大整除单位**：60 说"每 1 分钟"而不是"每 60 秒"；90 不能整除分钟，仍说"每 90 秒"
 * （凑成"每 1.5 分钟"既难读，也让两个不同间隔看起来一样）。
 */
export function formatInterval(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 1) return PLACEHOLDER
  const value = Math.floor(seconds)
  if (value % 86_400 === 0) return `每 ${value / 86_400} 天`
  if (value % 3_600 === 0) return `每 ${value / 3_600} 小时`
  if (value % 60 === 0) return `每 ${value / 60} 分钟`
  return `每 ${value} 秒`
}

/** 执行次数 → `已执行 X / Y 次`。 */
export function formatCount(executed: number, max: number): string {
  const done = Number.isFinite(executed) && executed > 0 ? Math.floor(executed) : 0
  const total = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  return `已执行 ${done} / ${total} 次`
}

/** 执行结果 → `成功 / 失败 / 已跳过`。 */
export function formatRunResult(result: ScheduleRunResult): string {
  switch (result) {
    case 'success':
      return '成功'
    case 'failed':
      return '失败'
    case 'skipped':
      return '已跳过'
    default:
      return PLACEHOLDER
  }
}

/** 跳过/失败原因 → 中文短语；`null` → 空串（调用方据此不渲染原因列内容）。 */
export function formatRunReason(reason: ScheduleRunReason | null): string {
  switch (reason) {
    case 'previous_run_active':
      return '上一轮尚未结束'
    case 'busy_limit':
      return '并发额度已满'
    case 'agent_unavailable':
      return '数字人不可用'
    case 'run_failed':
      return '执行失败'
    default:
      return ''
  }
}

/** 复用模式的重建标注；非重建 → 空串（不占位、不留白）。 */
export function formatRebuilt(rebuilt: boolean): string {
  return rebuilt ? '重建会话' : ''
}

/**
 * 任务状态文案（文字通道，与颜色圆点并列）。
 *
 * 优先级：系统停用原因 > 已结束 > 执行中 > 未开始。"已结束"优先于"执行中"是因为
 * 次数用尽的任务 `enabled` 仍为 true，光看开关会以为它还在跑。
 */
export function formatTaskStatus(
  task: Pick<ScheduledTask, 'status' | 'terminated' | 'disabled_reason'>,
): string {
  if (task.disabled_reason === 'agent_unavailable') return '数字人不可用（已停用）'
  if (task.terminated) return '已结束'
  return task.status === 'running' ? '执行中' : '未开始'
}

/** 下次触发时刻 → `下次 YYYY-MM-DD HH:mm:ss`；无待执行时刻 → `—`。 */
export function formatNextRun(task: Pick<ScheduledTask, 'next_run_at'>): string {
  if (!task.next_run_at) return PLACEHOLDER
  return `下次 ${formatDateTime(task.next_run_at)}`
}
