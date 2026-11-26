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
  store: ScheduledTaskStore;
  runs: ScheduledTaskRunStore;
  events: ScheduledTaskEvents;
  ticker: ScheduledTaskTicker;
  runner: ScheduledTaskRunner;
  start(): void;
  stop(): void;
}

export interface BuildScheduledTasksOptions {
  root: string;
  mcpConnectTimeoutMs: number;
  logger: RunnerLogger;
  threadStore: ThreadStore;
  runManager: RunManager;
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
