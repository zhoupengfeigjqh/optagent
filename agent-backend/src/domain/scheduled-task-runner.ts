/**
 * 定时任务执行器（015）：一次触发 = 用**既有对话链路**跑一轮，不是第二套对话系统。
 *
 * 顺序固定（`plan.md` §2）：数字人可用性 → 确定本轮会话（新建 / 复用 / 重建）→
 * 并发额度 → 取实例 + MCP 有界等待 → `startRun` → 计次 → 等 `settled` → 落记录 + `touch`。
 * 因为历史落盘、usage 记账、工具装配、思考开关全部沿用 `RunManager`，
 * 定时任务的会话在聊天区里与手动对话完全同构（只多一个 `source` 来源标记）。
 *
 * 三条口径（`FR-041`/`FR-043`/research D4）：
 * 1. **次数只算真正开跑的一轮**（success / failed）；上一轮未完、额度已满、数字人不可用
 *    这三种 `skipped` **不计次数**，故 `markTriggered` 必须在 `startRun` 成功之后调用
 *    （心跳只负责推进 `next_run_at`，见 `infra/scheduled-task-ticker.ts`）。
 * 2. **会话不存在不等于失败**：复用模式下 `threadStore.get` 抛 `ThreadNotFoundError`
 *    是"用户删了会话"的正常分支，重建后继续；任务保持启用（`FR-061`）。
 * 3. **不重试**（`FR-044`）：失败只落一条记录，下一轮按计划时刻照常触发。
 *
 * `dispatch` **永不 reject**：所有失败都在内部落成 `failed` 记录，避免与心跳的兜底
 * 记录重复（一条触发只能有一条记录）。
 */
import { AgentConfigError } from './agent-instance.js';
import { PoolExhaustedError } from './agent-pool.js';
import { unavailableReason } from './agent-scope.js';
import { MAX_ACTIVE_THREADS_PER_USER } from './run-limits.js';
import {
  ThreadBusyLimitError,
  ThreadRunActiveError,
  type Run,
  type RunAgentLike,
  type RunManager,
} from './run-manager.js';
import { scheduledThreadTitle } from './scheduled-task-schedule.js';
import type { ScheduledTask, ScheduledTaskStore } from './scheduled-task-store.js';
import type { ScheduleRunReason, ScheduledTaskRunStore } from './scheduled-task-run-store.js';
import type { ScheduledTaskEvents } from './scheduled-task-events.js';
import { ThreadNotFoundError, type ThreadSource, type ThreadStore } from './thread-store.js';
import type { PoolKey } from '../types.js';

/** 日志最小契约（与 pino 的 `warn(obj, msg)` 同形） */
export interface RunnerLogger {
  warn(payload: Record<string, unknown>, message: string): void;
}

/** 执行器看到的实例契约：`RunManager` 要的部分 + MCP 就绪有界等待 */
export interface ScheduledRunnerAgent extends RunAgentLike {
  mcpReady(timeoutMs: number): Promise<boolean>;
}

/** 一次触发的入参（与心跳的 `TaskDispatcher` 结构一致，可直接注册） */
export interface TaskDispatchParams {
  userId: string;
  agentName: string;
  /** 心跳推进过 `next_run_at` 之后的任务快照 */
  task: ScheduledTask;
  /** 计划触发时刻（ISO UTC） */
  triggeredAt: string;
}

export interface ScheduledTaskRunnerDeps {
  root: string;
  store: ScheduledTaskStore;
  runs: ScheduledTaskRunStore;
  events: ScheduledTaskEvents;
  threadStore: ThreadStore;
  runManager: RunManager;
  /**
   * 取实例口：由装配层注入**与路由同一份**的单飞 + 实例池。
   * 执行器自建工厂会造出第二套 MCP 连接（且池外实例无人回收）。
   */
  getOrCreateAgent: (key: PoolKey) => Promise<ScheduledRunnerAgent>;
  /** MCP 建连有界等待（超时降级继续，与手动对话同口径） */
  mcpConnectTimeoutMs: number;
  logger?: RunnerLogger;
  /** 注入时钟（测试用） */
  now?: () => number;
}

/** 本轮会话的解析结果（记录与会话都用它，避免"再查一次"） */
interface ResolvedThread {
  threadId: string;
  /** 会话名快照：复用模式下是会话创建时的名称（用户改名后随之变化，不覆写） */
  threadTitle: string;
  /** 复用模式因原会话已删除而重建 */
  rebuilt: boolean;
}

export class ScheduledTaskRunner {
  constructor(private readonly deps: ScheduledTaskRunnerDeps) {}

  /**
   * 绑定给心跳的派发器（箭头函数：ticker 只持有函数引用，不关心 `this`）。
   *
   * 挂在 `registerDispatcher` 上的就是这个方法——`infra/` 因此不必 import 本模块。
   */
  readonly dispatch = async (params: TaskDispatchParams): Promise<void> => {
    const { userId, agentName, task, triggeredAt } = params;
    let thread: ResolvedThread | null = null;
    try {
      // ① 数字人可用性（唯一判据同 `agent-scope`）：不可用 → 自动停用 + skipped
      const unusable = unavailableReason(this.deps.root, userId, agentName);
      if (unusable !== undefined) {
        this.deps.store.disableBySystem(userId, agentName, task.taskId, 'agent_unavailable');
        this.recordSkipped(userId, agentName, task, triggeredAt, 'agent_unavailable', unusable);
        this.warn(
          {
            event: 'scheduled_task.run.agent_unavailable',
            user_id: userId,
            agent_name: agentName,
            task_id: task.taskId,
            reason: unusable,
          },
          '数字人不可用，任务已自动停用',
        );
        return;
      }

      // ② 本轮会话（新建 / 复用 / 重建）
      thread = this.resolveThread(userId, agentName, task, triggeredAt);

      // ③ 并发额度：与手动对话共用（跨数字人累计，唯一判定入口）
      let release: () => void;
      try {
        release = this.deps.runManager.acquireQuota(
          userId,
          thread.threadId,
          MAX_ACTIVE_THREADS_PER_USER,
        );
      } catch (err) {
        if (err instanceof ThreadBusyLimitError) {
          this.recordSkipped(userId, agentName, task, triggeredAt, 'busy_limit', err.message);
          return;
        }
        if (err instanceof ThreadRunActiveError) {
          this.recordSkipped(
            userId,
            agentName,
            task,
            triggeredAt,
            'previous_run_active',
            '该会话本轮仍在执行，本次触发跳过',
          );
          return;
        }
        throw err;
      }

      try {
        await this.runOnce(userId, agentName, task, thread, triggeredAt);
      } finally {
        // startRun 已转正时是 no-op；未走到 startRun 才真正归还额度
        release();
      }
    } catch (err) {
      // 兜底：任何未分类异常都落成一条 failed（不重试，下一轮按计划照常）
      this.record(
        userId,
        agentName,
        task,
        triggeredAt,
        {
          result: 'failed',
          reason: 'run_failed',
          reasonText: err instanceof Error ? err.message : String(err),
          threadId: thread?.threadId ?? null,
          threadTitle: thread?.threadTitle ?? null,
          rebuilt: thread?.rebuilt ?? false,
        },
      );
      this.warn(
        {
          err,
          event: 'scheduled_task.run.failed',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
        },
        '定时任务执行异常（已记录，不重试）',
      );
    }
  };

  /* ---------------- 执行 ---------------- */

  /** 取实例 → 等 MCP → 开跑 → 计次 → 等收尾 → 落记录 */
  private async runOnce(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    thread: ResolvedThread,
    triggeredAt: string,
  ): Promise<void> {
    let agent: ScheduledRunnerAgent;
    try {
      agent = await this.deps.getOrCreateAgent({ userId, agentName });
    } catch (err) {
      if (err instanceof AgentConfigError) {
        this.deps.store.disableBySystem(userId, agentName, task.taskId, 'agent_unavailable');
        this.recordSkipped(userId, agentName, task, triggeredAt, 'agent_unavailable', err.message);
        return;
      }
      if (err instanceof PoolExhaustedError) {
        this.recordSkipped(userId, agentName, task, triggeredAt, 'busy_limit', err.message);
        return;
      }
      throw err;
    }

    await this.waitMcpReady(agent, userId, agentName, task);

    let run: Run;
    try {
      run = this.deps.runManager.startRun({
        userId,
        threadId: thread.threadId,
        agent,
        userMessage: task.prompt,
        thinking: task.thinking,
      });
    } catch (err) {
      if (err instanceof ThreadRunActiveError) {
        this.recordSkipped(
          userId,
          agentName,
          task,
          triggeredAt,
          'previous_run_active',
          '该会话本轮仍在执行，本次触发跳过',
        );
        return;
      }
      throw err;
    }

    agent.activeThreads += 1;
    // 真正开跑：此刻才计次（FR-041）。写盘失败只告警——本轮已经在跑，不应因此中断
    try {
      this.deps.store.markTriggered(userId, agentName, task.taskId, { triggeredAt });
    } catch (err) {
      this.warn(
        {
          err,
          event: 'scheduled_task.store.write_failed',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
        },
        '已执行次数写盘失败（本轮照常执行，次数可能少记一次）',
      );
    }
    // 次数 +1 要尽快反映到列表（FR-041：用户可见的合理时间内）
    this.deps.events.emitChanged(userId);

    const failure: { message: string | null } = { message: null };
    const unsubscribe = run.subscribe((e) => {
      if (e.type === 'error') failure.message = e.data.error.message;
    });
    try {
      await run.settled;
    } finally {
      unsubscribe();
      agent.activeThreads -= 1;
    }

    // touch：只刷新 updated_at（归属与来源在创建时写定，MUST NOT 覆写）
    this.deps.threadStore.touch(userId, agentName, thread.threadId);

    const ok = run.state === 'done';
    this.record(userId, agentName, task, triggeredAt, {
      result: ok ? 'success' : 'failed',
      reason: ok ? null : 'run_failed',
      reasonText: ok ? null : (failure.message ?? '本轮执行被中断'),
      threadId: thread.threadId,
      threadTitle: thread.threadTitle,
      rebuilt: thread.rebuilt,
    });
    if (!ok) {
      this.warn(
        {
          event: 'scheduled_task.run.failed',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
          thread_id: thread.threadId,
          reason: failure.message,
        },
        '定时任务本轮执行失败（已记录，不重试）',
      );
    }
  }

  /** MCP 就绪有界等待：超时即降级开跑（缺工具但回答不中断），并落结构化日志 */
  private async waitMcpReady(
    agent: ScheduledRunnerAgent,
    userId: string,
    agentName: string,
    task: ScheduledTask,
  ): Promise<void> {
    try {
      const ready = await agent.mcpReady(this.deps.mcpConnectTimeoutMs);
      if (ready) return;
      this.warn(
        {
          event: 'scheduled_task.run.mcp_timeout',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
          timeout_ms: this.deps.mcpConnectTimeoutMs,
        },
        'MCP 建连未在超时内落定，本轮按现有可用工具开跑（降级）',
      );
    } catch (err) {
      this.warn(
        {
          err,
          event: 'scheduled_task.run.mcp_error',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
        },
        'MCP 就绪等待异常，本轮按现有可用工具开跑（降级）',
      );
    }
  }

  /* ---------------- 会话 ---------------- */

  /**
   * 确定本轮会话：每轮新建 / 复用 / 复用但已删（重建）。
   *
   * 复用模式的"会话已删"判据只有一条：`threadStore.get` 抛 `ThreadNotFoundError`
   * （目录不存在或 meta 不可读——两者在存储层不可区分，都按"用户删了"处理）。
   * 重建出的会话仍写 `source`，左栏闪电标记因此始终成立（`SC-004`）。
   */
  private resolveThread(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    triggeredAt: string,
  ): ResolvedThread {
    const title = scheduledThreadTitle(task.name, triggeredAt);
    const source: ThreadSource = {
      type: 'scheduled_task',
      taskId: task.taskId,
      taskName: task.name,
      triggeredAt,
    };

    // 每轮新建（缺省；缺字段的历史任务按此处理，FR-064）
    if (task.newThreadPerRun || task.reusedThreadId === null) {
      return this.createThread(userId, agentName, task, title, source, false);
    }

    try {
      const meta = this.deps.threadStore.get(userId, agentName, task.reusedThreadId);
      // 复用命中：不建会话、不改标题（用户手动重命名后 MUST NOT 被覆写，FR-063）
      return { threadId: meta.threadId, threadTitle: meta.title ?? title, rebuilt: false };
    } catch (err) {
      if (!(err instanceof ThreadNotFoundError)) throw err;
      const rebuilt = this.createThread(userId, agentName, task, title, source, true);
      this.warn(
        {
          event: 'scheduled_task.run.rebuild',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
          old_thread_id: task.reusedThreadId,
          thread_id: rebuilt.threadId,
        },
        '复用的会话已不存在，已重建会话并继续执行（任务保持启用）',
      );
      return rebuilt;
    }
  }

  /** 新建会话（复用模式下同时记住归属：首轮或重建） */
  private createThread(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    title: string,
    source: ThreadSource,
    rebuilt: boolean,
  ): ResolvedThread {
    const meta = this.deps.threadStore.create(userId, agentName, { title, source });
    if (!task.newThreadPerRun) {
      this.deps.store.attachThread(userId, agentName, task.taskId, meta.threadId);
    }
    return { threadId: meta.threadId, threadTitle: title, rebuilt };
  }

  /* ---------------- 记录 ---------------- */

  private recordSkipped(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    triggeredAt: string,
    reason: ScheduleRunReason,
    reasonText: string | null,
  ): void {
    this.record(userId, agentName, task, triggeredAt, {
      result: 'skipped',
      reason,
      reasonText,
      threadId: null,
      threadTitle: null,
      rebuilt: false,
    });
    this.warn(
      {
        event: 'scheduled_task.run.skipped',
        user_id: userId,
        agent_name: agentName,
        task_id: task.taskId,
        reason,
      },
      '定时任务本次触发被跳过（不计次数）',
    );
  }

  private record(
    userId: string,
    agentName: string,
    task: ScheduledTask,
    triggeredAt: string,
    outcome: {
      result: 'success' | 'failed' | 'skipped';
      reason: ScheduleRunReason | null;
      reasonText: string | null;
      threadId: string | null;
      threadTitle: string | null;
      rebuilt: boolean;
    },
  ): void {
    try {
      this.deps.runs.append(userId, agentName, {
        taskId: task.taskId,
        taskName: task.name,
        agentName,
        triggeredAt,
        finishedAt: new Date(this.now()).toISOString(),
        ...outcome,
      });
    } catch (err) {
      // 记录写不进去不能影响任务状态：下一次触发照常，历史少一条（已知限制）
      this.warn(
        {
          err,
          event: 'scheduled_task.run.record_failed',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
        },
        '运行记录写入失败（本轮执行结果未留档）',
      );
    }
    this.deps.events.emitChanged(userId);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private warn(payload: Record<string, unknown>, message: string): void {
    this.deps.logger?.warn(payload, message);
  }
}
