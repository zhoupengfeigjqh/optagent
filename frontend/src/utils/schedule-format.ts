
import type { ScheduleRunReason, ScheduleRunResult, ScheduledTask } from '../api/types'
import { formatTimestamp } from './format'

const PLACEHOLDER = '—'

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

export function formatCount(executed: number, max: number): string {
  const done = Number.isFinite(executed) && executed > 0 ? Math.floor(executed) : 0
  const total = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0
  return `已执行 ${done} / ${total} 次`
}

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

export function formatNextRun(task: Pick<ScheduledTask, 'next_run_at'>): string {
  if (!task.next_run_at) return PLACEHOLDER
  return `下次 ${formatDateTime(task.next_run_at)}`
}
