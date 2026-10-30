/**
 * 定时任务的**纯判定**（015）：下次触发时刻、终止判据、状态派生、会话名格式化。
 *
 * 刻意做成无 IO 的纯函数：调度逻辑全部可单测，心跳只负责"到点就派发"。
 * 任何一处需要"下次该不该跑 / 什么时候跑"的判断，都 MUST 调用这里，
 * 不允许在 ticker / runner / 路由里各写一套时间算式（原则二）。
 */

/** 一个任务在调度上需要的最小视图（与存储实体的字段同名，便于直接传入） */
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

/** 执行状态（接口下发值；前端只做文案映射，不自行推导） */
export type ScheduledTaskStatus = 'idle' | 'running';

function toMs(iso: string): number {
  return Date.parse(iso);
}

/**
 * 把某个时刻按间隔推进到**严格晚于** `nowMs` 的下一个计划时刻。
 *
 * 用途有两个：
 * - 触发后推进 `next_run_at`（避免同一时刻被重复触发）；
 * - 启用 / 服务重启时把落在过去的计划时刻推进到未来（**不补跑**，`FR-045`）。
 *
 * 注意：`from` 往往早于 `now` 很多（停机数小时），逐次相加会退化成 O(间隔数)；
 * 因此这里用数学跳跃一次算到未来，再做最多一轮修正（吸收取整误差）。
 */
export function advanceToFuture(fromMs: number, intervalSeconds: number, nowMs: number): number {
  const interval = Math.max(1, Math.trunc(intervalSeconds)) * 1000;
  if (fromMs > nowMs) return fromMs;
  const steps = Math.floor((nowMs - fromMs) / interval) + 1;
  let next = fromMs + steps * interval;
  if (next <= nowMs) next += interval;
  return next;
}

/** 首次计划时刻（= 开始时间） */
export function firstRunAt(startAt: string): number {
  return toMs(startAt);
}

/** 次数用尽或已过截止时刻 → 不再触发（派生，不落盘） */
export function isTerminated(task: SchedulableTask, nowMs: number): boolean {
  if (task.executedCount >= task.maxRuns) return true;
  const deadline = toMs(task.deadlineAt);
  return Number.isFinite(deadline) && nowMs > deadline;
}

/**
 * 启动按钮是否可用：未终止且数字人可用。
 *
 * 与"当前是否已启用"无关——已启用的任务按钮应可点（用于停用）。
 */
export function canStart(task: SchedulableTask, nowMs: number): boolean {
  return !isTerminated(task, nowMs) && task.disabledReason === null;
}

/**
 * 状态派生：`running` = 已启用、未终止、且还有待执行的计划时刻。
 *
 * 不落盘的原因：它是 `enabled + 次数 + 截止 + now` 的函数，落盘就会漂移
 * （宪章原则五：不存第二份可漂移的状态）。
 */
export function deriveStatus(task: SchedulableTask, nowMs: number): ScheduledTaskStatus {
  if (!task.enabled || task.nextRunAt === null || isTerminated(task, nowMs)) return 'idle';
  return 'running';
}

/**
 * 会话名：`任务名 + 触发时刻（本地时区 YYYY-MM-DD HH:mm:ss）`。
 *
 * 用服务器本地时区（与界面上展示的时刻同源）；精确到秒足以区分同一个任务的多次执行
 * （需求只允许"间隔秒数 ≥1"）。
 */
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
