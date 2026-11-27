import fs from 'node:fs';
import path from 'node:path';
import { threadDir } from '../dirs.js';
import type { PlanFinishReason, StepStatus } from './types.js';

export const PLAN_RECORD_KEEP = 100;

export interface PlanRecordStep {
  seq_id: number;
  task_name: string;
  type: string;
  core_action: string;
  status: StepStatus;
  attempts: number;
}

export interface PlanRunRecord {
  goal: string;
  reason: PlanFinishReason;
  total_steps: number;
  rolls: number;
  replans: number;
  duration_ms: number;
  done_summary: string[];
  steps: PlanRecordStep[];
}

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
