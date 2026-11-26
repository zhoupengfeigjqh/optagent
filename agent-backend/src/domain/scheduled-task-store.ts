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
  startAt: string;
  intervalSeconds: number;
  maxRuns: number;
  deadlineAt: string;
  /** `true` = 每轮新建会话；`false` = 复用同一会话（创建后不可修改） */
  newThreadPerRun: boolean;
  reusedThreadId: string | null;
  enabled: boolean;
  executedCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  disabledReason: 'agent_unavailable' | null;
  agentName: string;
  createdAt: string;
  updatedAt: string;
}

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

export interface TaskDomain {
  userId: string;
  agentName: string;
  tasks: ScheduledTask[];
}

const CURRENT_VERSION = 1;

export class ScheduledTaskStore {
  constructor(private readonly root: string) {}


  private dirOf(userId: string, agentName: string): string {
    return scheduledTasksDir(this.root, userId, agentName);
  }

  private fileOf(userId: string, agentName: string): string {
    return path.join(this.dirOf(userId, agentName), 'tasks.json');
  }


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
          // 单个数字人目录读取失败则跳过
        }
      }
    }
    return domains;
  }


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

  remove(userId: string, agentName: string, taskId: string): void {
    const tasks = this.list(userId, agentName);
    const index = tasks.findIndex((t) => t.taskId === taskId);
    if (index < 0) throw new ScheduledTaskNotFoundError(taskId);
    const task = tasks[index]!;
    if (task.enabled) throw new ScheduledTaskEnabledError(task.name);
    tasks.splice(index, 1);
    this.write(userId, agentName, tasks);
  }

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

  closeSchedule(userId: string, agentName: string, taskId: string): void {
    this.patch(userId, agentName, taskId, (task) => {
      task.nextRunAt = null;
    });
  }


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
