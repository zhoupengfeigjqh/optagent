/**
 * 单元测试：定时任务执行器（015，T028 / T028a / T031a / T059）。
 *
 * 钉住四类语义：
 * 1. **会话**：每轮新建带 `title` + `source`；复用命中不建会话、不改标题；
 *    复用但会话已删 → 重建 + `rebuilt=true` + 更新 `reused_thread_id`（FR-061/063）。
 * 2. **计数口径**（FR-041/043，research D4）：`success` / `failed` 各 +1；
 *    三种 `skipped`（上一轮未完 / 额度已满 / 数字人不可用）**不计数**。
 * 3. **不停用**：会话删除、额度已满都 MUST NOT 停用任务；只有数字人不可用才自动停用（FR-055）。
 * 4. **多任务同刻**（FR-046）：各自拿到不同会话，不合并。
 *
 * 走的是**真实** `RunManager` + 真实文件存储，只有 Agent 实例是假的
 * （与 `run-manager-*.spec.ts` 同一手法）：执行链路不能被测试替身改变。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentDir } from '../../src/domain/dirs.js';
import { HistoryStore } from '../../src/domain/history.js';
import {
  RunManager,
  type AgentRunRequest,
} from '../../src/domain/run-manager.js';
import { ScheduledTaskEvents } from '../../src/domain/scheduled-task-events.js';
import {
  ScheduledTaskRunner,
  type ScheduledRunnerAgent,
} from '../../src/domain/scheduled-task-runner.js';
import { ScheduledTaskRunStore } from '../../src/domain/scheduled-task-run-store.js';
import {
  ScheduledTaskStore,
  type CreateScheduledTaskInput,
  type ScheduledTask,
} from '../../src/domain/scheduled-task-store.js';
import { ThreadStore } from '../../src/domain/thread-store.js';
import { UsageDb } from '../../src/infra/usage-db.js';
import type { LlmEvent } from '../../src/types.js';

const USER = 'admin';
const AGENT = 'demo';
const LIMIT = 3;

let root: string;
let usage: UsageDb;
let store: ScheduledTaskStore;
let runs: ScheduledTaskRunStore;
let events: ScheduledTaskEvents;
let threadStore: ThreadStore;
let runManager: RunManager;

/** 最小可用数字人配置（判据同 `agent-scope`：能完整加载） */
function writeAgent(name = AGENT): void {
  const dir = agentDir(root, USER, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  fs.writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

async function* okTurn(): AsyncIterable<LlmEvent> {
  yield { type: 'content_delta', delta: '好的' };
  yield { type: 'done', usage: { inputTokens: 3, outputTokens: 1 } };
}

async function* failTurn(): AsyncIterable<LlmEvent> {
  yield { type: 'error', code: 'LLM_ERROR', message: '模型返回失败' };
}

interface FakeAgent extends ScheduledRunnerAgent {
  requests: AgentRunRequest[];
}

function fakeAgent(turn: () => AsyncIterable<LlmEvent> = okTurn): FakeAgent {
  const requests: AgentRunRequest[] = [];
  return {
    key: { userId: USER, agentName: AGENT },
    activeThreads: 0,
    requests,
    mcpReady: async () => true,
    run(req) {
      requests.push(req);
      return turn();
    },
  };
}

function newRunner(
  agentOrProvider: ScheduledRunnerAgent | (() => Promise<ScheduledRunnerAgent>),
): ScheduledTaskRunner {
  const getAgent =
    typeof agentOrProvider === 'function'
      ? (agentOrProvider as () => Promise<ScheduledRunnerAgent>)
      : async () => agentOrProvider;
  return new ScheduledTaskRunner({
    root,
    store,
    runs,
    events,
    threadStore,
    runManager,
    getOrCreateAgent: getAgent,
    mcpConnectTimeoutMs: 100,
  });
}

/** 建一个任务（默认：每轮新建会话、开始时刻在过去、间隔 60s、次数 5） */
function createTask(overrides: Partial<CreateScheduledTaskInput> = {}): ScheduledTask {
  const input: CreateScheduledTaskInput = {
    name: '日报',
    prompt: '汇总今天的项目进度',
    thinking: false,
    startAt: new Date(Date.now() - 60_000).toISOString(),
    intervalSeconds: 60,
    maxRuns: 5,
    deadlineAt: new Date(Date.now() + 86_400_000).toISOString(),
    newThreadPerRun: true,
    ...overrides,
  };
  return store.create(USER, AGENT, input);
}

const triggeredAt = new Date('2026-10-30T01:02:03.000Z').toISOString();

/** 派发一次（ticker 的入参形态） */
async function dispatch(runner: ScheduledTaskRunner, task: ScheduledTask): Promise<void> {
  await runner.dispatch({ userId: USER, agentName: AGENT, task, triggeredAt });
}

const latestRun = () => runs.read(USER, AGENT).runs[0]!;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduled-runner-'));
  usage = new UsageDb(path.join(root, 'usage.db'));
  store = new ScheduledTaskStore(root);
  runs = new ScheduledTaskRunStore(root);
  events = new ScheduledTaskEvents();
  threadStore = new ThreadStore(root);
  runManager = new RunManager({ history: new HistoryStore(root), usage });
  writeAgent();
});

afterEach(() => {
  usage.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('每轮新建会话（缺省模式）', () => {
  it('成功：建带 title + source 的会话，记录 success，次数 +1', async () => {
    const task = createTask();
    const agent = fakeAgent();

    await dispatch(newRunner(agent), task);
    const run = latestRun();

    expect(run).toMatchObject({
      taskId: task.taskId,
      taskName: '日报',
      agentName: AGENT,
      result: 'success',
      reason: null,
      rebuilt: false,
    });
    expect(run.threadId).toBeTruthy();
    expect(run.threadTitle).toMatch(/^日报 /);
    expect(run.finishedAt).not.toBeNull();

    const meta = threadStore.get(USER, AGENT, run.threadId!);
    expect(meta.title).toBe(run.threadTitle);
    expect(meta.source).toEqual({
      type: 'scheduled_task',
      taskId: task.taskId,
      taskName: '日报',
      triggeredAt,
    });

    // 提示词与本轮 thinking 取自任务配置
    expect(agent.requests[0]).toMatchObject({
      threadId: run.threadId,
      thinking: false,
    });
    expect(store.get(USER, AGENT, task.taskId).executedCount).toBe(1);
  });

  it('失败：记录 failed + 原因摘要，次数同样 +1（FR-041/044）', async () => {
    const task = createTask();
    const agent = fakeAgent(failTurn);
    const runner = newRunner(agent);

    await dispatch(runner, task);

    expect(latestRun()).toMatchObject({
      result: 'failed',
      reason: 'run_failed',
      reasonText: '模型返回失败',
    });
    expect(store.get(USER, AGENT, task.taskId).executedCount).toBe(1);
  });
});

describe('会话复用模式（FR-061/062/063）', () => {
  it('复用命中：不新建会话、不改标题，记录指向同一会话', async () => {
    const existing = threadStore.create(USER, AGENT, { title: '手工会话' });
    const task = createTask({ newThreadPerRun: false });
    store.attachThread(USER, AGENT, task.taskId, existing.threadId);
    const agent = fakeAgent();

    await dispatch(newRunner(agent), store.get(USER, AGENT, task.taskId));

    const run = latestRun();
    expect(run.threadId).toBe(existing.threadId);
    expect(run.threadTitle).toBe('手工会话');
    expect(run.rebuilt).toBe(false);
    expect(threadStore.list(USER, AGENT)).toHaveLength(1);
    expect(threadStore.get(USER, AGENT, existing.threadId).title).toBe('手工会话');
  });

  it('用户重命名后 **不覆写** 标题（FR-063）', async () => {
    const existing = threadStore.create(USER, AGENT, { title: '手工会话' });
    threadStore.rename(USER, AGENT, existing.threadId, '我改过的名字');
    const task = createTask({ newThreadPerRun: false });
    store.attachThread(USER, AGENT, task.taskId, existing.threadId);

    await dispatch(newRunner(fakeAgent()), store.get(USER, AGENT, task.taskId));

    expect(threadStore.get(USER, AGENT, existing.threadId).title).toBe('我改过的名字');
    expect(latestRun().threadTitle).toBe('我改过的名字');
  });

  it('会话已被删除：重建 + rebuilt=true + 更新 reused_thread_id，任务保持启用', async () => {
    const task = createTask({ newThreadPerRun: false });
    store.attachThread(USER, AGENT, task.taskId, 'ghost-thread');
    store.setEnabled(USER, AGENT, task.taskId, true, task.nextRunAt);

    await dispatch(newRunner(fakeAgent()), store.get(USER, AGENT, task.taskId));

    const run = latestRun();
    expect(run).toMatchObject({ result: 'success', rebuilt: true });
    expect(run.threadId).not.toBe('ghost-thread');

    const reloaded = store.get(USER, AGENT, task.taskId);
    expect(reloaded.reusedThreadId).toBe(run.threadId);
    expect(reloaded.enabled).toBe(true);
    expect(reloaded.executedCount).toBe(1);
    // 重建出的会话同样带来源标记（SC-004）
    expect(threadStore.get(USER, AGENT, run.threadId!).source?.taskId).toBe(task.taskId);
  });

  it('meta 不可读按"会话已删"处理：重建而不是失败（存储层两者不可区分）', async () => {
    const existing = threadStore.create(USER, AGENT, { title: '坏会话' });
    const metaFile = path.join(
      root,
      'users',
      USER,
      'user-data',
      AGENT,
      'threads',
      existing.threadId,
      'meta.json',
    );
    fs.writeFileSync(metaFile, '{ 不是 JSON', 'utf8');
    const task = createTask({ newThreadPerRun: false });
    store.attachThread(USER, AGENT, task.taskId, existing.threadId);

    await dispatch(newRunner(fakeAgent()), store.get(USER, AGENT, task.taskId));

    expect(latestRun()).toMatchObject({ result: 'success', rebuilt: true });
  });
});

describe('跳过与计数口径（FR-041/043）', () => {
  it('并发额度已满：记录 skipped/busy_limit，不计次数，不停用任务', async () => {
    const releases = ['t1', 't2', 't3'].map((id) => runManager.acquireQuota(USER, id, LIMIT));
    const task = createTask();

    await dispatch(newRunner(fakeAgent()), task);

    expect(latestRun()).toMatchObject({ result: 'skipped', reason: 'busy_limit', threadId: null });
    const reloaded = store.get(USER, AGENT, task.taskId);
    expect(reloaded.executedCount).toBe(0);
    expect(reloaded.enabled).toBe(false); // 从未启用，不是被系统停用
    expect(reloaded.disabledReason).toBeNull();
    releases.forEach((release) => release());
  });

  it('同一会话上一轮仍在执行：记录 skipped/previous_run_active，不计次数', async () => {
    const existing = threadStore.create(USER, AGENT, { title: '在跑的会话' });
    const task = createTask({ newThreadPerRun: false });
    store.attachThread(USER, AGENT, task.taskId, existing.threadId);
    // 占住该会话（模拟上一轮还没收尾）
    const release = runManager.acquireQuota(USER, existing.threadId, LIMIT);

    await dispatch(newRunner(fakeAgent()), store.get(USER, AGENT, task.taskId));

    expect(latestRun()).toMatchObject({
      result: 'skipped',
      reason: 'previous_run_active',
      threadId: null,
    });
    expect(store.get(USER, AGENT, task.taskId).executedCount).toBe(0);
    release();
  });

  it('数字人不可用：记录 skipped/agent_unavailable + 自动停用（FR-055），不计次数', async () => {
    const task = createTask();
    store.setEnabled(USER, AGENT, task.taskId, true, task.nextRunAt);
    fs.rmSync(agentDir(root, USER, AGENT), { recursive: true, force: true });

    await dispatch(newRunner(fakeAgent()), store.get(USER, AGENT, task.taskId));

    expect(latestRun()).toMatchObject({ result: 'skipped', reason: 'agent_unavailable' });
    const reloaded = store.get(USER, AGENT, task.taskId);
    expect(reloaded.enabled).toBe(false);
    expect(reloaded.disabledReason).toBe('agent_unavailable');
    expect(reloaded.nextRunAt).toBeNull();
    expect(reloaded.executedCount).toBe(0);
  });

  it('取实例时池满（PoolExhausted）按额度已满处理，不计次数', async () => {
    const task = createTask();
    const provider = async () => {
      const { PoolExhaustedError } = await import('../../src/domain/agent-pool.js');
      throw new PoolExhaustedError('实例池已满');
    };

    await dispatch(newRunner(provider), task);

    expect(latestRun()).toMatchObject({ result: 'skipped', reason: 'busy_limit' });
    expect(store.get(USER, AGENT, task.taskId).executedCount).toBe(0);
  });
});

describe('多任务同刻（FR-046）', () => {
  it('两个任务各自拿到不同会话，互不合并', async () => {
    const first = createTask({ name: '任务一' });
    const second = createTask({ name: '任务二' });
    const runner = newRunner(fakeAgent());

    await dispatch(runner, first);
    await dispatch(runner, second);

    const list = runs.read(USER, AGENT).runs;
    expect(list).toHaveLength(2);
    const ids = list.map((run) => run.threadId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(list.every((run) => run.result === 'success')).toBe(true);
  });
});
