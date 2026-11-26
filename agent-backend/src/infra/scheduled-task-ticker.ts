import type { ScheduleRunReason } from '../domain/scheduled-task-run-store.js';
import type { ScheduledTaskRunStore } from '../domain/scheduled-task-run-store.js';
import type { ScheduledTaskEvents } from '../domain/scheduled-task-events.js';
import {
  advanceToFuture,
  isTerminated,
} from '../domain/scheduled-task-schedule.js';
import type { ScheduledTask, ScheduledTaskStore } from '../domain/scheduled-task-store.js';

/** 心跳间隔（毫秒）：1s 巡检的固有延迟 ≤1s，满足"触发偏差 ≤5s"（SC-003） */
export const TICK_INTERVAL_MS = 1000;

export interface TickerLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

export type TaskDispatcher = (params: {
  userId: string;
  agentName: string;
  task: ScheduledTask;
  triggeredAt: string;
}) => Promise<void> | void;

export interface TickerDeps {
  store: ScheduledTaskStore;
  runs: ScheduledTaskRunStore;
  events: ScheduledTaskEvents;
  logger?: TickerLogger;
  now?: () => number;
  intervalMs?: number;
  isDraining?: () => boolean;
}

export class ScheduledTaskTicker {
  private timer: NodeJS.Timeout | null = null;
  private dispatcher: TaskDispatcher | null = null;
  private readonly inflight = new Set<string>();
  private stopped = true;

  constructor(private readonly deps: TickerDeps) {}

  /** 注册执行器（runner 就绪后调用；未注册时心跳安全空转） */
  registerDispatcher(dispatcher: TaskDispatcher): void {
    this.dispatcher = dispatcher;
  }

  start(): void {
    if (this.timer !== null) return;
    this.stopped = false;
    this.normalizeOnStart();
    const interval = this.deps.intervalMs ?? TICK_INTERVAL_MS;
    this.timer = setInterval(() => this.tick(), interval);
    // 不阻碍进程退出：调度是后台能力，不能把 Ctrl+C 卡住
    this.timer.unref?.();
  }

  /** 关服：先置停止标记再清定时器，避免最后 1 秒再派发一轮 */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  isInflight(taskId: string): boolean {
    return this.inflight.has(taskId);
  }

  normalizeOnStart(): void {
    const now = this.now();
    for (const { userId, agentName, tasks } of this.safeDomains()) {
      for (const task of tasks) {
        try {
          if (!task.enabled) continue;
          if (isTerminated(task, now)) {
            this.deps.store.closeSchedule(userId, agentName, task.taskId);
            continue;
          }
          if (task.nextRunAt === null) continue;
          const nextMs = Date.parse(task.nextRunAt);
          if (!Number.isFinite(nextMs) || nextMs > now) continue;
          const future = advanceToFuture(nextMs, task.intervalSeconds, now);
          this.deps.store.advanceWithoutCount(
            userId,
            agentName,
            task.taskId,
            new Date(future).toISOString(),
          );
          this.log({
            event: 'scheduled_task.tick.catch_up_skipped',
            user_id: userId,
            agent_name: agentName,
            task_id: task.taskId,
            planned_at: task.nextRunAt,
            next_at: new Date(future).toISOString(),
          }, '重启/启用时发现错过的计划时刻，已推进到未来且不补跑');
        } catch (err) {
          this.logWarn(err, userId, agentName, task.taskId);
        }
      }
    }
  }

  tick(): void {
    if (this.stopped) return;
    if (this.deps.isDraining?.() === true) return;
    const now = this.now();
    for (const { userId, agentName, tasks } of this.safeDomains()) {
      for (const task of tasks) {
        try {
          this.consider(userId, agentName, task, now);
        } catch (err) {
          this.logWarn(err, userId, agentName, task.taskId);
        }
      }
    }
  }


  private consider(userId: string, agentName: string, task: ScheduledTask, now: number): void {
    if (!task.enabled) return;
    if (isTerminated(task, now)) {
      if (task.nextRunAt !== null) this.deps.store.closeSchedule(userId, agentName, task.taskId);
      return;
    }
    if (task.nextRunAt === null) return;
    const plannedMs = Date.parse(task.nextRunAt);
    if (!Number.isFinite(plannedMs) || plannedMs > now) return;

    const plannedAt = new Date(plannedMs).toISOString();
    const future = new Date(advanceToFuture(plannedMs, task.intervalSeconds, now)).toISOString();

    if (this.inflight.has(task.taskId)) {
      this.deps.store.advanceWithoutCount(userId, agentName, task.taskId, future);
      this.recordSkipped(userId, agentName, task, plannedAt, 'previous_run_active');
      this.deps.events.emitChanged(userId);
      return;
    }

    const updated = this.deps.store.advanceWithoutCount(
      userId,
      agentName,
      task.taskId,
      future,
    );

    if (this.dispatcher === null) {
      this.log(
        {
          event: 'scheduled_task.tick.no_dispatcher',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
        },
        '心跳已到点但执行器尚未注册，本轮跳过',
      );
      return;
    }

    this.inflight.add(task.taskId);
    const run = this.dispatcher({ userId, agentName, task: updated, triggeredAt: plannedAt });
    void Promise.resolve(run)
      .catch((err: unknown) => {
        this.deps.runs.append(userId, agentName, {
          taskId: task.taskId,
          taskName: task.name,
          agentName,
          triggeredAt: plannedAt,
          finishedAt: new Date().toISOString(),
          result: 'failed',
          reason: 'run_failed',
          reasonText: err instanceof Error ? err.message : String(err),
          threadId: null,
          threadTitle: null,
          rebuilt: false,
        });
        this.logWarn(err, userId, agentName, task.taskId);
      })
      .finally(() => {
        this.inflight.delete(task.taskId);
        this.deps.events.emitChanged(userId);
      });
  }

  private recordSkipped(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    triggeredAt: string,
    reason: ScheduleRunReason,
  ): void {
    this.deps.runs.append(userId, agentName, {
      taskId: task.taskId,
      taskName: task.name,
      agentName,
      triggeredAt,
      finishedAt: triggeredAt,
      result: 'skipped',
      reason,
      reasonText: reason === 'previous_run_active' ? '上一轮仍在执行，本轮跳过' : null,
      threadId: null,
      threadTitle: null,
      rebuilt: false,
    });
  }

  private safeDomains(): Array<{ userId: string; agentName: string; tasks: ScheduledTask[] }> {
    try {
      return this.deps.store.listDomains();
    } catch (err) {
      this.logWarn(err, '', '', '');
      return [];
    }
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private log(payload: Record<string, unknown>, message: string): void {
    this.deps.logger?.warn(payload, message);
  }

  private logWarn(err: unknown, userId: string, agentName: string, taskId: string): void {
    this.deps.logger?.warn(
      {
        err,
        event: 'scheduled_task.tick.failed',
        user_id: userId,
        agent_name: agentName,
        task_id: taskId,
      },
      '定时任务心跳处理失败（已跳过该任务，下一轮继续）',
    );
  }
}
