
export interface SchedulableTask {
  startAt: string;
  intervalSeconds: number;
  maxRuns: number;
  deadlineAt: string;
  executedCount: number;
  enabled: boolean;
  nextRunAt: string | null;
  disabledReason: 'agent_unavailable' | null;
}

export type ScheduledTaskStatus = 'idle' | 'running';

function toMs(iso: string): number {
  return Date.parse(iso);
}

export function advanceToFuture(fromMs: number, intervalSeconds: number, nowMs: number): number {
  const interval = Math.max(1, Math.trunc(intervalSeconds)) * 1000;
  if (fromMs > nowMs) return fromMs;
  const steps = Math.floor((nowMs - fromMs) / interval) + 1;
  let next = fromMs + steps * interval;
  if (next <= nowMs) next += interval;
  return next;
}

export function firstRunAt(startAt: string): number {
  return toMs(startAt);
}

export function isTerminated(task: SchedulableTask, nowMs: number): boolean {
  if (task.executedCount >= task.maxRuns) return true;
  const deadline = toMs(task.deadlineAt);
  return Number.isFinite(deadline) && nowMs > deadline;
}

export function canStart(task: SchedulableTask, nowMs: number): boolean {
  return !isTerminated(task, nowMs) && task.disabledReason === null;
}

export function deriveStatus(task: SchedulableTask, nowMs: number): ScheduledTaskStatus {
  if (!task.enabled || task.nextRunAt === null || isTerminated(task, nowMs)) return 'idle';
  return 'running';
}

export function scheduledThreadTitle(taskName: string, triggeredAt: string): string {
  return `${taskName} ${formatLocalDateTime(triggeredAt)}`;
}

/** ISO → 本地 `YYYY-MM-DD HH:mm:ss`（不依赖任何第三方库，避免为一行格式化引依赖） */
export function formatLocalDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}
