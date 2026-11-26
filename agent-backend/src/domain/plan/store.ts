/**
 * 计划留档（`plan.jsonl`，2026-11-26）。
 *
 * 三条硬约束：
 * 1. **只记录、不参与上下文组装**——运行期没有任何读取方，`readAll` 只服务事后分析与测试；
 * 2. **与 `history.jsonl` 物理分离**——计划与快照绝不进历史，避免被"读历史即装配上下文"带回模型；
 * 3. **有界**——超过 `PLAN_RECORD_KEEP` 条即重写保留最近 100 条，重写用"临时文件 + 原子改名"。
 *
 * 落点：`user-data/{数字人}/threads/{thread_id}/plan.jsonl`（与 `intent-focus.jsonl` 同层）。
 * 写入失败只告警，不影响本轮对话（与聚焦留档同口径）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { threadDir } from '../dirs.js';
import type { PlanFinishReason, StepStatus } from './types.js';

/** 单线程保留的计划条数 */
export const PLAN_RECORD_KEEP = 100;

/** 记录里的一步（只留排障需要的标识与计数，不留正文） */
export interface PlanRecordStep {
  seq_id: number;
  task_name: string;
  type: string;
  core_action: string;
  status: StepStatus;
  attempts: number;
}

/** 一轮计划的过程事实（不含归属字段） */
export interface PlanRunRecord {
  goal: string;
  reason: PlanFinishReason;
  total_steps: number;
  rolls: number;
  replans: number;
  duration_ms: number;
  /** 已完成步骤结论（与滚动规划输入同源） */
  done_summary: string[];
  steps: PlanRecordStep[];
}

/** 落盘的一行 */
export interface PlanRecord extends PlanRunRecord {
  at: string;
  thread_id: string;
  agent_name: string;
}

export interface PlanStoreLogger {
  warn(msg: string): void;
}

export class PlanStore {
  /** per-thread Promise 链：同线程串行写，避免交错 */
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly logger?: PlanStoreLogger,
  ) {}

  /** 记录文件绝对路径（测试与排障用） */
  filePathOf(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'plan.jsonl');
  }

  /** 追加一条记录；**任何失败都不抛出**（留档不得影响对话） */
  append(
    userId: string,
    agentName: string,
    threadId: string,
    record: PlanRunRecord,
  ): Promise<void> {
    const key = `${userId}/${agentName}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doAppend(userId, agentName, threadId, record));
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  /** 读取全部合法记录（仅供分析与测试；**不是**上下文组装路径） */
  readAll(userId: string, agentName: string, threadId: string): PlanRecord[] {
    const file = this.filePathOf(userId, agentName, threadId);
    if (!fs.existsSync(file)) return [];
    const out: PlanRecord[] = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        out.push(JSON.parse(line) as PlanRecord);
      } catch {
        // 坏行跳过：留档损坏不得影响任何读取方
      }
    }
    return out;
  }

  private async doAppend(
    userId: string,
    agentName: string,
    threadId: string,
    record: PlanRunRecord,
  ): Promise<void> {
    try {
      const file = this.filePathOf(userId, agentName, threadId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const line: PlanRecord = {
        ...record,
        at: new Date().toISOString(),
        thread_id: threadId,
        agent_name: agentName,
      };
      await fs.promises.appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
      this.compactIfNeeded(file);
    } catch (err) {
      this.logger?.warn(`[plan] 留档写入失败（不影响本轮对话）：${(err as Error).message}`);
    }
  }

  /** 超过保留条数则重写最近 100 条；失败只告警并保留原文件 */
  private compactIfNeeded(file: string): void {
    try {
      const lines = fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim().length > 0);
      if (lines.length <= PLAN_RECORD_KEEP) return;
      const keep = lines.slice(-PLAN_RECORD_KEEP);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${keep.join('\n')}\n`, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      this.logger?.warn(`[plan] 留档整理失败（保留原文件）：${(err as Error).message}`);
    }
  }
}
