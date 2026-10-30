/**
 * 定时任务心跳（015）：**唯一**的调度时钟。
 *
 * 为什么是"一个心跳巡检"而不是"每个任务一个定时器"：
 * - 启停、删除、次数用尽、截止到期、服务重启，全部是"下次该不该触发"的判断；
 *   收敛到 `scheduled-task-schedule.ts` 的纯函数后可以完全单测，不必操作真实时钟；
 * - 每任务一个 `setTimeout` 需要与持久化状态双向同步，任一处漏清就是幽灵触发，
 *   且定时器数量随任务线性增长（宪章原则六：不引调度库、不堆基础设施）。
 *
 * 三条关键语义：
 * 1. **先占时刻**：到点后先把 `next_run_at` 推进到未来并落盘，再派发执行——
 *    进程中途被杀也不会重复触发同一时刻。**次数不在这里 +1**：只有真正开跑的一轮
 *    才计次数（`FR-041`/`FR-043`），由执行器开跑前调 `markTriggered` 完成
 *    （跳过的一轮根本走不到那一步）。
 * 2. **不并发堆积**：同一 `task_id` 有在途执行时，本轮记 `skipped`（不计数）并推进时刻。
 * 3. **不补跑**：启动 / 启用时若 `next_run_at` 已在过去，直接推进到未来，**不触发**。
 *
 * 派发器用 `registerDispatcher` 注入：`infra/` 不 import `domain/scheduled-task-runner`，
 * 否则 Phase 2 的骨架要依赖 Phase 3 的执行器（也便于测试注入假派发器）。
 */
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

/** 日志最小契约（与 pino 的 `warn(obj, msg)` 同形，便于测试传桩） */
export interface TickerLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

/** 派发器：执行一次任务（由 runner 在 Phase 3 注册） */
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
  /** 可注入时钟（测试用假时钟） */
  now?: () => number;
  /** 可注入间隔（测试可缩短；生产恒为 1s） */
  intervalMs?: number;
  /**
   * 关服排空判定（`RunManager.isDraining`）：为真时本轮巡检不派发新任务。
   *
   * 与 `stop()` 互补——排空期内核还在跑、定时器可能还没清，缺这道闸会在
   * "已排空"之后又开一轮，进程随即退出，留下写一半的回答。
   */
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

  /** 启动：先做一次"补齐计划时刻"的规整（不触发），再开始按秒巡检 */
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

  /** 是否在跑（测试与就绪探针用） */
  isRunning(): boolean {
    return this.timer !== null;
  }

  /** 某任务是否仍在执行（跳过判据；测试可直接观察） */
  isInflight(taskId: string): boolean {
    return this.inflight.has(taskId);
  }

  /**
   * 启动 / 启用时的规整：把落在过去的 `next_run_at` 推进到未来，**不触发**（不补跑）。
   *
   * 只处理已启用且未终止的任务；终止的清空计划时刻（保留 enabled 以便用户看到原配置）。
   */
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

  /** 单轮巡检（暴露出来便于测试直接调用，不必等真实时钟） */
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

  /* ---------------- 内部 ---------------- */

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

    // ① 上一轮仍在执行：跳过 + 推进时刻，且不计次数（FR-043）
    if (this.inflight.has(task.taskId)) {
      this.deps.store.advanceWithoutCount(userId, agentName, task.taskId, future);
      this.recordSkipped(userId, agentName, task, plannedAt, 'previous_run_active');
      this.deps.events.emitChanged(userId);
      return;
    }

    // ② 先占时刻：只推进 next_run_at（不计数），落盘后再派发——进程被杀也不会重复触发
    const updated = this.deps.store.advanceWithoutCount(
      userId,
      agentName,
      task.taskId,
      future,
    );

    if (this.dispatcher === null) {
      // 派发器尚未注册（Phase 2 骨架期）：只推进时刻，不产生"假执行"记录
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
