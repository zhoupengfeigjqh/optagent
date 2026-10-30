/**
 * 单元测试：定时任务心跳（015，T016 / T016a）。
 *
 * 心跳是**唯一**调度时钟，这里用注入的假时钟直接驱动 `tick()`，不碰真实定时器。
 * 钉住六件事：
 * 1. 到期才派发；同一时刻只派发一次（派发前后都推进 `next_run_at`）。
 * 2. 心跳**不计数**：次数由执行器开跑后 +1（`FR-041`/`FR-043`）。
 * 3. 同一任务在途时跳过并记 `skipped`，不并发堆积（`FR-043`）。
 * 4. `stop()` / 关服排空（`isDraining`）后不再派发。
 * 5. 未注册派发器时安全空转（Phase 2 骨架）。
 * 6. 重启不补跑（`FR-045`/`SC-007`）：过去的计划时刻只推进，不触发历史时刻。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduledTaskEvents } from '../../src/domain/scheduled-task-events.js';
import { ScheduledTaskRunStore } from '../../src/domain/scheduled-task-run-store.js';
import {
  ScheduledTaskStore,
  type CreateScheduledTaskInput,
  type ScheduledTask,
} from '../../src/domain/scheduled-task-store.js';
import {
  ScheduledTaskTicker,
  type TaskDispatcher,
} from '../../src/infra/scheduled-task-ticker.js';

const USER = 'admin';
const AGENT = 'demo';
/** 假时钟起点：2026-10-30T03:00:00Z */
const NOW = Date.parse('2026-10-30T03:00:00.000Z');
const INTERVAL_SECONDS = 60;

let root: string;
let store: ScheduledTaskStore;
let runs: ScheduledTaskRunStore;
let events: ScheduledTaskEvents;
let nowMs: number;
/** 需要 stop() 的 ticker（afterEach 统一收尾，避免残留 interval） */
let live: ScheduledTaskTicker[];

function createTask(
  overrides: Partial<CreateScheduledTaskInput> = {},
  nextRunAt: string | null = new Date(NOW + 60_000).toISOString(),
): ScheduledTask {
  const input: CreateScheduledTaskInput = {
    name: '巡检',
    prompt: '看一下今天的日志',
    thinking: false,
    startAt: new Date(NOW).toISOString(),
    intervalSeconds: INTERVAL_SECONDS,
    maxRuns: 5,
    deadlineAt: new Date(NOW + 86_400_000).toISOString(),
    newThreadPerRun: true,
    ...overrides,
  };
  const created = store.create(USER, AGENT, input);
  store.setEnabled(USER, AGENT, created.taskId, true, nextRunAt);
  return store.get(USER, AGENT, created.taskId);
}

function newTicker(opts: {
  dispatcher?: TaskDispatcher;
  draining?: boolean;
  tickMs?: number;
} = {}): ScheduledTaskTicker {
  const ticker = new ScheduledTaskTicker({
    store,
    runs,
    events,
    now: () => nowMs,
    intervalMs: opts.tickMs ?? 3_600_000,
    ...(opts.draining === undefined ? {} : { isDraining: () => opts.draining === true }),
  });
  if (opts.dispatcher) ticker.registerDispatcher(opts.dispatcher);
  live.push(ticker);
  return ticker;
}

const runsOf = () => runs.read(USER, AGENT).runs;
const reload = (task: ScheduledTask) => store.get(USER, AGENT, task.taskId);

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-ticker-'));
  store = new ScheduledTaskStore(root);
  runs = new ScheduledTaskRunStore(root);
  events = new ScheduledTaskEvents();
  nowMs = NOW;
  live = [];
});

afterEach(() => {
  for (const ticker of live) ticker.stop();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('到期判定与派发', () => {
  it('未到期不派发', () => {
    const task = createTask({}, new Date(NOW + 60_000).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();

    ticker.tick();

    expect(dispatcher).not.toHaveBeenCalled();
    expect(reload(task).nextRunAt).toBe(task.nextRunAt);
  });

  it('到期派发一次：触发时刻＝计划时刻，`next_run_at` 推进到未来，**心跳不计数**', () => {
    const task = createTask({}, new Date(NOW + 1_000).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();

    nowMs = NOW + 1_000;
    ticker.tick();

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const params = dispatcher.mock.calls[0]![0] as {
      userId: string;
      agentName: string;
      task: ScheduledTask;
      triggeredAt: string;
    };
    expect(params).toMatchObject({ userId: USER, agentName: AGENT });
    expect(params.triggeredAt).toBe(new Date(NOW + 1_000).toISOString());

    const reloaded = reload(task);
    expect(reloaded.nextRunAt).toBe(new Date(NOW + 1_000 + 60_000).toISOString());
    // FR-041：次数由执行器开跑后 +1，心跳不碰
    expect(reloaded.executedCount).toBe(0);
  });

  it('同一时刻重复 tick 不会重复派发（时刻已推进）', () => {
    const task = createTask({}, new Date(NOW).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();
    // start 的规整已把"恰好现在"推走；显式把它拉回过去，模拟稳态到点
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();
    ticker.tick();

    expect(dispatcher).toHaveBeenCalledTimes(1);
  });

  it('启用中但次数用尽：清空计划时刻且不再派发（FR-042）', () => {
    const task = createTask({ maxRuns: 1 });
    store.markTriggered(USER, AGENT, task.taskId, { triggeredAt: new Date(NOW).toISOString() });
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();

    nowMs = NOW + 60_000;
    ticker.tick();

    expect(dispatcher).not.toHaveBeenCalled();
    expect(reload(task).nextRunAt).toBeNull();
  });

  it('已停用的任务不派发', () => {
    const task = createTask();
    store.setEnabled(USER, AGENT, task.taskId, false);
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();

    nowMs = NOW + 60_000;
    ticker.tick();

    expect(dispatcher).not.toHaveBeenCalled();
    expect(runsOf()).toHaveLength(0);
  });
});

describe('在途跳过', () => {
  it('上一轮仍在执行：记 skipped/previous_run_active，推进时刻且不计数（FR-043）', async () => {
    const task = createTask({}, new Date(NOW).toISOString());
    // 永不 resolve：模拟"上一轮还在跑"
    const dispatcher = vi.fn(() => new Promise<void>(() => {}));
    const ticker = newTicker({ dispatcher });
    ticker.start();
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();
    expect(ticker.isInflight(task.taskId)).toBe(true);

    nowMs = NOW + INTERVAL_SECONDS * 1000;
    ticker.tick();

    expect(dispatcher).toHaveBeenCalledTimes(1);
    const skipped = runsOf()[0]!;
    expect(skipped).toMatchObject({
      taskId: task.taskId,
      result: 'skipped',
      reason: 'previous_run_active',
      threadId: null,
    });
    expect(reload(task).executedCount).toBe(0);
    expect(reload(task).nextRunAt).toBe(new Date(NOW + 2 * INTERVAL_SECONDS * 1000).toISOString());
  });

  it('派发 promise 落定后退出在途表', async () => {
    const task = createTask({}, new Date(NOW).toISOString());
    const ticker = newTicker({ dispatcher: () => Promise.resolve() });
    ticker.start();
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(ticker.isInflight(task.taskId)).toBe(false);
  });
});

describe('停止与关服', () => {
  it('stop() 之后不再派发', () => {
    const task = createTask({}, new Date(NOW).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();
    ticker.stop();
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();

    expect(ticker.isRunning()).toBe(false);
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it('关服排空（isDraining）为真时不派发', () => {
    const task = createTask({}, new Date(NOW).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher, draining: true });
    ticker.start();
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();

    expect(dispatcher).not.toHaveBeenCalled();
    expect(runsOf()).toHaveLength(0);
  });

  it('未注册派发器时安全空转：只推进时刻，不产生假记录', () => {
    const task = createTask({}, new Date(NOW).toISOString());
    const ticker = newTicker();
    ticker.start();
    store.advanceWithoutCount(USER, AGENT, task.taskId, new Date(NOW).toISOString());

    ticker.tick();

    expect(runsOf()).toHaveLength(0);
    expect(reload(task).nextRunAt).toBe(new Date(NOW + INTERVAL_SECONDS * 1000).toISOString());
    expect(reload(task).executedCount).toBe(0);
  });
});

describe('重启与不补跑（FR-045 / SC-007）', () => {
  it('启动时把过去的计划时刻推进到未来：不触发、不补历史时刻', () => {
    const task = createTask({}, new Date(NOW - 5 * 60_000).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });

    ticker.start();

    expect(dispatcher).not.toHaveBeenCalled();
    expect(runsOf()).toHaveLength(0);
    // 5 分钟前 + 60s 间隔 → 下一个严格晚于现在的时刻
    expect(reload(task).nextRunAt).toBe(new Date(NOW + 60_000).toISOString());
    expect(reload(task).executedCount).toBe(0);
  });

  it('重启后到达下一个计划时刻只触发一次', () => {
    createTask({}, new Date(NOW - 5 * 60_000).toISOString());
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });
    ticker.start();

    nowMs = NOW + 60_000;
    ticker.tick();
    ticker.tick();

    expect(dispatcher).toHaveBeenCalledTimes(1);
  });

  it('已停用的任务重启后仍不触发', () => {
    const task = createTask({}, new Date(NOW - 5 * 60_000).toISOString());
    store.setEnabled(USER, AGENT, task.taskId, false);
    const dispatcher = vi.fn();
    const ticker = newTicker({ dispatcher });

    ticker.start();
    nowMs = NOW + 60_000;
    ticker.tick();

    expect(dispatcher).not.toHaveBeenCalled();
  });
});
