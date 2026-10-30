/**
 * 定时任务存储（015）：`users/{uid}/user-data/{agent}/scheduled-tasks/tasks.json`。
 *
 * 三条硬约束：
 * 1. **原子替换**：先写 `tasks.json.tmp` 再 `rename`，任何时刻读到的都是完整 JSON
 *    （Windows 上 `rename` 走 `MoveFileExW(REPLACE_EXISTING)`，可覆盖同名文件）。
 * 2. **同步 API**：全部方法同步执行。Node 单线程下同步 fs 不会被其他请求插队，
 *    因此"读-改-写"天然串行，不需要额外锁（与 `HistoryStore` 的异步串行链是两种场景：
 *    那边要等 IO 完成，这边一次系统调用即结束）。
 * 3. **损坏不静默**：JSON 解析失败抛 `ScheduledTaskStoreError`，上层映射 500 并落日志；
 *    MUST NOT 返回空列表冒充"没有任务"（`FR-057`）。
 *
 * 归属由目录位置承载：跨用户 / 跨数字人访问在路径层就解析不到（`FR-053`/`FR-054`）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEDULED_TASKS_DIR, scheduledTasksDir, userDataDir } from './dirs.js';

/** 任务名上限（与界面校验同口径） */
export const TASK_NAME_MAX = 50;
/** 任务提示词上限（与聊天输入框单条消息上限同口径） */
export const TASK_PROMPT_MAX = 8000;

export interface ScheduledTask {
  taskId: string;
  name: string;
  prompt: string;
  thinking: boolean;
  /** 首次触发时刻（ISO UTC） */
  startAt: string;
  intervalSeconds: number;
  maxRuns: number;
  /** 有效截止时刻（ISO UTC） */
  deadlineAt: string;
  /** `true` = 每轮新建会话；`false` = 复用同一会话（创建后不可修改） */
  newThreadPerRun: boolean;
  /** 复用模式下的会话标识（首轮写入；会话被删后由下一次触发重建并更新） */
  reusedThreadId: string | null;
  enabled: boolean;
  /** 已执行次数：只有**已开跑**的一轮（成功/失败）才 +1 */
  executedCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  /** 系统自动停用的原因；用户手动停用为 `null` */
  disabledReason: 'agent_unavailable' | null;
  agentName: string;
  createdAt: string;
  updatedAt: string;
}

/** 新建入参（派生字段由 store 填） */
export interface CreateScheduledTaskInput {
  name: string;
  prompt: string;
  thinking: boolean;
  startAt: string;
  intervalSeconds: number;
  maxRuns: number;
  deadlineAt: string;
  newThreadPerRun: boolean;
}

/** 编辑入参：可改的 7 项。会话模式不在其中——创建后不可改（`FR-060`）。 */
export interface UpdateScheduledTaskInput {
  name: string;
  prompt: string;
  thinking: boolean;
  startAt: string;
  intervalSeconds: number;
  maxRuns: number;
  deadlineAt: string;
}

/** 存储层错误：任务不存在 / 重名 / 启用中删除 / 已终止 / 数据损坏 */
export class ScheduledTaskNotFoundError extends Error {
  readonly code = 'SCHEDULED_TASK_NOT_FOUND';
  constructor(taskId: string) {
    super(`定时任务不存在：${taskId}`);
    this.name = 'ScheduledTaskNotFoundError';
  }
}

export class ScheduledTaskNameConflictError extends Error {
  readonly code = 'SCHEDULED_TASK_NAME_CONFLICT';
  constructor(name: string) {
    super(`任务名称已存在：${name}`);
    this.name = 'ScheduledTaskNameConflictError';
  }
}

export class ScheduledTaskEnabledError extends Error {
  readonly code = 'SCHEDULED_TASK_ENABLED';
  constructor(name: string) {
    super(`任务「${name}」仍在启用中，请先停止任务再删除`);
    this.name = 'ScheduledTaskEnabledError';
  }
}

export class ScheduledTaskExhaustedError extends Error {
  readonly code = 'SCHEDULED_TASK_EXHAUSTED';
  constructor(name: string) {
    super(`任务「${name}」已执行完或已超过截止时间，无法启动`);
    this.name = 'ScheduledTaskExhaustedError';
  }
}

/** 存储损坏（JSON 不可解析 / 结构不符）：上层 500 + 结构化日志，MUST NOT 静默清空 */
export class ScheduledTaskStoreError extends Error {
  readonly code = 'SCHEDULED_TASK_STORE_CORRUPT';
  constructor(file: string, reason: string) {
    super(`定时任务数据损坏（${file}）：${reason}`);
    this.name = 'ScheduledTaskStoreError';
  }
}

interface TasksFile {
  version: number;
  tasks: ScheduledTask[];
}

/** 一个（用户, 数字人）域内的任务集合 */
export interface TaskDomain {
  userId: string;
  agentName: string;
  tasks: ScheduledTask[];
}

const CURRENT_VERSION = 1;

export class ScheduledTaskStore {
  constructor(private readonly root: string) {}

  /* ---------------- 路径 ---------------- */

  private dirOf(userId: string, agentName: string): string {
    return scheduledTasksDir(this.root, userId, agentName);
  }

  private fileOf(userId: string, agentName: string): string {
    return path.join(this.dirOf(userId, agentName), 'tasks.json');
  }

  /* ---------------- 读 ---------------- */

  /** 该域的全部任务（文件缺失 = 空数组，不是错误） */
  list(userId: string, agentName: string): ScheduledTask[] {
    const file = this.fileOf(userId, agentName);
    let raw: string;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ScheduledTaskStoreError(file, err instanceof Error ? err.message : 'JSON 解析失败');
    }
    const tasks = (parsed as Partial<TasksFile>)?.tasks;
    if (!Array.isArray(tasks)) throw new ScheduledTaskStoreError(file, '缺少 tasks 数组');
    return tasks.filter((t): t is ScheduledTask => typeof t?.taskId === 'string');
  }

  get(userId: string, agentName: string, taskId: string): ScheduledTask {
    const found = this.list(userId, agentName).find((t) => t.taskId === taskId);
    if (!found) throw new ScheduledTaskNotFoundError(taskId);
    return found;
  }

  /** 扫描全部（用户 × 数字人）域：心跳巡检用，避免漏掉非当前选中的数字人 */
  listDomains(): TaskDomain[] {
    const domains: TaskDomain[] = [];
    for (const userId of listDirNames(path.join(this.root, 'users'))) {
      const dataRoot = userDataDir(this.root, userId, '').replace(/[\\/]+$/, '');
      for (const agentName of listDirNames(dataRoot)) {
        const dir = path.join(dataRoot, agentName, SCHEDULED_TASKS_DIR);
        if (!fs.existsSync(dir)) continue;
        try {
          const tasks = this.list(userId, agentName);
          if (tasks.length > 0) domains.push({ userId, agentName, tasks });
        } catch {
          /* 单个域损坏不阻断其他域的调度；损坏本身在下一次接口调用时暴露 */
        }
      }
    }
    return domains;
  }

  /* ---------------- 写 ---------------- */

  create(
    userId: string,
    agentName: string,
    input: CreateScheduledTaskInput,
    now: Date = new Date(),
  ): ScheduledTask {
    const tasks = this.list(userId, agentName);
    const name = input.name.trim();
    if (tasks.some((t) => t.name === name)) throw new ScheduledTaskNameConflictError(name);
    const iso = now.toISOString();
    const task: ScheduledTask = {
      taskId: randomUUID(),
      name,
      prompt: input.prompt,
      thinking: input.thinking,
      startAt: input.startAt,
      intervalSeconds: input.intervalSeconds,
      maxRuns: input.maxRuns,
      deadlineAt: input.deadlineAt,
      newThreadPerRun: input.newThreadPerRun,
      reusedThreadId: null,
      enabled: false,
      executedCount: 0,
      nextRunAt: input.startAt,
      lastRunAt: null,
      disabledReason: null,
      agentName,
      createdAt: iso,
      updatedAt: iso,
    };
    tasks.push(task);
    this.write(userId, agentName, tasks);
    return task;
  }

  /**
   * 编辑（2026-10-30 增补，`FR-065`~`FR-069`）：**只有停用中的任务可改**。
   *
   * 三条口径：
   * 1. 会话模式与 `reusedThreadId` 不在入参里——创建后不可改（`FR-060`），
   *    既有会话归属也 MUST NOT 被追溯改写（`FR-061`）；
   * 2. `executedCount` / `lastRunAt` 保留：改配置不追溯已发生的执行，
   *    是否有下一次由派生的 `terminated` 判定（次数上限可能被改小）；
   * 3. `nextRunAt` 重置为新的开始时刻（停用态本就无排程；启用时由路由推进到未来）。
   *
   * 启用中一律拒绝（`SCHEDULED_TASK_ENABLED`）：与删除同一道闸，
   * 避免"编辑进行中恰好触发一轮"导致读到的配置与提交的不是同一份。
   */
  update(
    userId: string,
    agentName: string,
    taskId: string,
    input: UpdateScheduledTaskInput,
  ): ScheduledTask {
    const tasks = this.list(userId, agentName);
    const index = tasks.findIndex((t) => t.taskId === taskId);
    if (index < 0) throw new ScheduledTaskNotFoundError(taskId);
    const task = tasks[index]!;
    if (task.enabled) throw new ScheduledTaskEnabledError(task.name);
    const name = input.name.trim();
    if (tasks.some((t, i) => i !== index && t.name === name)) {
      throw new ScheduledTaskNameConflictError(name);
    }
    task.name = name;
    task.prompt = input.prompt;
    task.thinking = input.thinking;
    task.startAt = input.startAt;
    task.intervalSeconds = input.intervalSeconds;
    task.maxRuns = input.maxRuns;
    task.deadlineAt = input.deadlineAt;
    task.nextRunAt = input.startAt;
    task.updatedAt = new Date().toISOString();
    this.write(userId, agentName, tasks);
    return task;
  }

  /**
   * 启停：启用时把落在过去的计划时刻推进到未来（不补跑）；停用保留 `next_run_at`。
   *
   * 启用会清掉系统停用原因（用户显式重启的意图优先）：数字人仍不可用时，
   * 下一次触发会重新判定并按 `FR-055` 再停用一次，因此不会留下"假启用"。
   * 停用**不清**原因——重复停用是幂等的，不该抹掉"数字人不可用"的标注。
   */
  setEnabled(
    userId: string,
    agentName: string,
    taskId: string,
    enabled: boolean,
    nextRunAt?: string | null,
  ): ScheduledTask {
    return this.patch(userId, agentName, taskId, (task) => {
      task.enabled = enabled;
      if (!enabled) return;
      task.disabledReason = null;
      if (nextRunAt !== undefined) task.nextRunAt = nextRunAt;
    });
  }

  /** 删除：启用中直接拒绝（`FR-018`） */
  remove(userId: string, agentName: string, taskId: string): void {
    const tasks = this.list(userId, agentName);
    const index = tasks.findIndex((t) => t.taskId === taskId);
    if (index < 0) throw new ScheduledTaskNotFoundError(taskId);
    const task = tasks[index]!;
    if (task.enabled) throw new ScheduledTaskEnabledError(task.name);
    tasks.splice(index, 1);
    this.write(userId, agentName, tasks);
  }

  /**
   * 本轮**真正开跑**：次数 +1、写入 `last_run_at`（`FR-041`）。
   *
   * 与心跳的 `advanceWithoutCount` 分工（缺一不可）：
   * - 心跳只把 `next_run_at` 推到未来——"先占时刻"防重复触发，与次数无关；
   * - 次数只由执行器在确认开跑后 +1——被跳过的一轮（上一轮未结束 / 额度已满 /
   *   数字人不可用）**不计次数**（`FR-043`，research D4）。
   *
   * `patch.nextRunAt` 可选：心跳已推进过时刻时不再重复写，省一次全量写盘。
   */
  markTriggered(
    userId: string,
    agentName: string,
    taskId: string,
    patch: { nextRunAt?: string; triggeredAt: string },
  ): ScheduledTask {
    return this.patch(userId, agentName, taskId, (task) => {
      task.executedCount += 1;
      if (patch.nextRunAt !== undefined) task.nextRunAt = patch.nextRunAt;
      task.lastRunAt = patch.triggeredAt;
    });
  }

  /** 被跳过的一轮：推进 next_run_at 但**不计数**（`FR-043`/`FR-041`） */
  advanceWithoutCount(
    userId: string,
    agentName: string,
    taskId: string,
    nextRunAt: string,
  ): ScheduledTask {
    return this.patch(userId, agentName, taskId, (task) => {
      task.nextRunAt = nextRunAt;
    });
  }

  /** 记录复用模式下的会话归属（首轮创建 / 重建后更新） */
  attachThread(
    userId: string,
    agentName: string,
    taskId: string,
    threadId: string,
  ): ScheduledTask {
    return this.patch(userId, agentName, taskId, (task) => {
      task.reusedThreadId = threadId;
    });
  }

  /** 数字人不可用等系统原因：自动停用并标注原因（`FR-055`） */
  disableBySystem(
    userId: string,
    agentName: string,
    taskId: string,
    reason: 'agent_unavailable' | null,
  ): ScheduledTask {
    return this.patch(userId, agentName, taskId, (task) => {
      task.enabled = false;
      task.disabledReason = reason;
      task.nextRunAt = null;
    });
  }

  /** 终止后清空计划时刻（次数用尽 / 已过截止）：保留 enabled 以便用户看到原配置 */
  closeSchedule(userId: string, agentName: string, taskId: string): void {
    this.patch(userId, agentName, taskId, (task) => {
      task.nextRunAt = null;
    });
  }

  /* ---------------- 内部 ---------------- */

  private patch(
    userId: string,
    agentName: string,
    taskId: string,
    mutate: (task: ScheduledTask) => void,
  ): ScheduledTask {
    const tasks = this.list(userId, agentName);
    const task = tasks.find((t) => t.taskId === taskId);
    if (!task) throw new ScheduledTaskNotFoundError(taskId);
    mutate(task);
    task.updatedAt = new Date().toISOString();
    this.write(userId, agentName, tasks);
    return task;
  }

  /** 原子替换写：临时文件 + rename（同目录，跨卷不成立） */
  private write(userId: string, agentName: string, tasks: ScheduledTask[]): void {
    const dir = this.dirOf(userId, agentName);
    fs.mkdirSync(dir, { recursive: true });
    const file = this.fileOf(userId, agentName);
    const tmp = `${file}.tmp`;
    const data: TasksFile = { version: CURRENT_VERSION, tasks };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  }
}

/** 目录名清单（不存在 → 空），排序保证扫描顺序稳定、便于测试 */
function listDirNames(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
