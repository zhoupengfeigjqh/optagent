/**
 * 定时任务执行记录（015）：`scheduled-tasks/runs.jsonl`，逐行追加、只增不改。
 *
 * 为什么用 jsonl 而不是 JSON 数组：运行记录只追加，追加是 O(1)；改写整份数组会在
 * 长跑后变成 O(n)，并把"写一半"的窗口放大（宪章原则五）。读取侧一次顺序读 +
 * 封顶条数，不逐条查会话（避免 N+1）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { scheduledTasksDir } from './dirs.js';

/** 记录结果：成功 / 失败 / 跳过（跳过不计次数） */
export type ScheduleRunResult = 'success' | 'failed' | 'skipped';

/** 失败或跳过的原因分类（前端只做文案映射） */
export type ScheduleRunReason =
  | 'previous_run_active'
  | 'busy_limit'
  | 'agent_unavailable'
  | 'run_failed';

export interface ScheduleRun {
  runId: string;
  taskId: string;
  /** 任务名快照：任务改名/删除后记录仍可读 */
  taskName: string;
  agentName: string;
  /** 计划触发时刻（ISO UTC） */
  triggeredAt: string;
  finishedAt: string | null;
  result: ScheduleRunResult;
  reason: ScheduleRunReason | null;
  /** 面向用户的中文原因摘要（失败消息截断到 200 字） */
  reasonText: string | null;
  threadId: string | null;
  /** 会话名快照（= 任务名 + 触发时刻；复用模式下为该会话创建时的名称） */
  threadTitle: string | null;
  /** 复用模式下本次因原会话已被删除而重建 */
  rebuilt: boolean;
}

/** 记录条数上限（读取侧封顶，防止长期运行后一次读太大） */
export const RUN_READ_LIMIT_MAX = 200;
/** 失败原因摘要最大长度 */
const REASON_TEXT_MAX = 200;

export class ScheduledTaskRunStore {
  constructor(private readonly root: string) {}

  private fileOf(userId: string, agentName: string): string {
    return path.join(scheduledTasksDir(this.root, userId, agentName), 'runs.jsonl');
  }

  /** 追加一条记录（同步写，保证"返回时已落盘"） */
  append(userId: string, agentName: string, run: Omit<ScheduleRun, 'runId'>): ScheduleRun {
    const record: ScheduleRun = {
      ...run,
      reasonText:
        run.reasonText === null
          ? null
          : [...run.reasonText].slice(0, REASON_TEXT_MAX).join(''),
      runId: randomUUID(),
    };
    const dir = scheduledTasksDir(this.root, userId, agentName);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.fileOf(userId, agentName), `${JSON.stringify(record)}\n`, 'utf8');
    return record;
  }

  /**
   * 读取记录：按触发时刻**倒序**，可按任务筛选并封顶条数。
   *
   * - `taskId`：只看某个任务；
   * - `onlyTaskIds`：只看**仍存在**的任务（`FR-022`：任务删除后其记录不再出现在弹窗里。
   *   存在性由调用方按 `tasks.json` 判定后传入——本模块不读任务文件，避免第二份判据）；
   * - `limit`：返回条数上限（1~200），`total` 始终是**筛选后**的总数。
   *
   * 损坏行直接跳过（一条坏行不该让整份历史不可读）；文件不存在 = 空数组。
   */
  read(
    userId: string,
    agentName: string,
    options: { taskId?: string; onlyTaskIds?: readonly string[]; limit?: number } = {},
  ): { runs: ScheduleRun[]; total: number } {
    const limit = Math.min(Math.max(1, options.limit ?? 50), RUN_READ_LIMIT_MAX);
    const only = options.onlyTaskIds === undefined ? null : new Set(options.onlyTaskIds);
    const all = this.readAll(userId, agentName).filter(
      (run) =>
        (options.taskId === undefined || run.taskId === options.taskId) &&
        (only === null || only.has(run.taskId)),
    );
    return { runs: all.slice(0, limit), total: all.length };
  }

  private readAll(userId: string, agentName: string): ScheduleRun[] {
    let raw: string;
    try {
      raw = fs.readFileSync(this.fileOf(userId, agentName), 'utf8');
    } catch {
      return [];
    }
    const runs: ScheduleRun[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      try {
        const parsed = JSON.parse(trimmed) as ScheduleRun;
        if (typeof parsed?.runId === 'string') runs.push(parsed);
      } catch {
        /* 坏行跳过：不因一行损坏丢掉整份历史 */
      }
    }
    // 同一毫秒内的多条记录保持稳定顺序：倒序后按 runId 兜底比较
    return runs.sort(
      (a, b) =>
        b.triggeredAt.localeCompare(a.triggeredAt) || b.runId.localeCompare(a.runId),
    );
  }
}
