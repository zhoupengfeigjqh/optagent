/**
 * 定时任务装配（015）：store / run-store / 事件总线 / 执行器 / 心跳 拼成一个包。
 *
 * 为什么外移成独立文件（与 `server-attachments.ts` 同一手法）：`server.ts` 已贴近
 * 500 行硬门禁（宪章原则二），装配细节留在那里必然超限；`server.ts` 只保留
 * "构造 + `start()` + `onClose` 内 `stop()`"。
 *
 * 这里也是**唯一**把执行器注册给心跳的地方（`registerDispatcher`）：
 * - `infra/scheduled-task-ticker.ts` 不 import `domain/scheduled-task-runner.ts`；
 * - `domain/` 也不 import `infra/`；
 * - 两侧只在这个装配层相遇（因此 Phase 2 的骨架不依赖 Phase 3 的执行器）。
 */
import { ScheduledTaskEvents } from './domain/scheduled-task-events.js';
import { ScheduledTaskRunStore } from './domain/scheduled-task-run-store.js';
import {
  ScheduledTaskRunner,
  type RunnerLogger,
  type ScheduledRunnerAgent,
} from './domain/scheduled-task-runner.js';
import { ScheduledTaskStore } from './domain/scheduled-task-store.js';
import type { RunManager } from './domain/run-manager.js';
import type { ThreadStore } from './domain/thread-store.js';
import { ScheduledTaskTicker } from './infra/scheduled-task-ticker.js';
import type { PoolKey } from './types.js';

export interface ScheduledTasksBundle {
  /** 任务集合（`tasks.json`） */
  store: ScheduledTaskStore;
  /** 运行记录（`runs.jsonl`） */
  runs: ScheduledTaskRunStore;
  /** 变更信号总线（SSE 路由订阅） */
  events: ScheduledTaskEvents;
  /** 唯一调度时钟 */
  ticker: ScheduledTaskTicker;
  /** 执行器（心跳的派发器已在此注册） */
  runner: ScheduledTaskRunner;
  /** 启动心跳（先规整错过的计划时刻，再按秒巡检） */
  start(): void;
  /** 关服：先置停止标记再清定时器 */
  stop(): void;
}

export interface BuildScheduledTasksOptions {
  root: string;
  /** MCP 建连有界等待（与手动对话同口径） */
  mcpConnectTimeoutMs: number;
  logger: RunnerLogger;
  threadStore: ThreadStore;
  runManager: RunManager;
  /** 取实例口：与路由共用同一份单飞 + 池 */
  getOrCreateAgent(key: PoolKey): Promise<ScheduledRunnerAgent>;
}

export function buildScheduledTasks(opts: BuildScheduledTasksOptions): ScheduledTasksBundle {
  const store = new ScheduledTaskStore(opts.root);
  const runs = new ScheduledTaskRunStore(opts.root);
  const events = new ScheduledTaskEvents();
  const runner = new ScheduledTaskRunner({
    root: opts.root,
    store,
    runs,
    events,
    threadStore: opts.threadStore,
    runManager: opts.runManager,
    getOrCreateAgent: opts.getOrCreateAgent,
    mcpConnectTimeoutMs: opts.mcpConnectTimeoutMs,
    logger: opts.logger,
  });
  const ticker = new ScheduledTaskTicker({
    store,
    runs,
    events,
    logger: opts.logger,
    // 关服排空期不再派发新任务（与既有 drain 同一条闸）
    isDraining: () => opts.runManager.isDraining(),
  });
  ticker.registerDispatcher(runner.dispatch);
  return {
    store,
    runs,
    events,
    ticker,
    runner,
    start: () => ticker.start(),
    stop: () => ticker.stop(),
  };
}
