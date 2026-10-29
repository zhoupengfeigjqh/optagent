/**
 * 意图聚焦（013）留档：`intent-focus.jsonl`（线程目录下的独立侧车文件）。
 *
 * 三条硬约束（规格 FR-020/022/023）：
 * 1. **与会话历史物理分离**——绝不写 `history.jsonl`，否则任何"读历史即组装上下文"
 *    的实现路径都可能把聚焦内容带进下一轮（这是本特性最重的约束）；
 * 2. **运行期没有读取方**——`readAll` 只服务于事后分析与测试；
 * 3. **有界**——超过 256KB 或 200 行即重写保留最近 100 条，重写用"临时文件 + 原子改名"。
 *
 * 并发：per-thread Promise 链串行（与 `history.ts` 同范式）；写入失败只告警，不影响对话。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IntentFocusDisposition } from './intent-focus.js';
import { threadDir } from './dirs.js';

/** 单线程记录上限：字节 */
export const MAX_RECORD_BYTES = 256 * 1024;
/** 单线程记录上限：行数 */
export const MAX_RECORD_LINES = 200;
/** 触发重写后保留的条数 */
export const KEEP_RECORD_LINES = 100;

/** 一条判定记录（字段口径见 `data-model.md §6.1`） */
export interface IntentFocusRecord {
  at: string;
  thread_id: string;
  agent_name: string;
  message_id: string | null;
  seq: number;
  input: string;
  input_truncated: boolean;
  disposition: IntentFocusDisposition;
  reason: string | null;
  model: string | null;
  round_ms: number | null;
  candidates: number;
  /** 本次判定实际发出的批数（`noul` 分批后：1 批 ≈ 32 题） */
  batches: number;
  truncated: boolean;
  /** `noul` 分数表（工具名 → 分数）；判定失败或跳过时为 null */
  probabilities: Record<string, number> | null;
  actions: string[];
  focus_prompt: string;
  error: string | null;
}

/** 调用方提供的字段（`at` / `seq` 由存储补齐） */
export type IntentFocusRecordDraft = Omit<IntentFocusRecord, 'at' | 'seq'> & { at?: string };

export interface IntentFocusStoreLogger {
  warn(msg: string): void;
}

export class IntentFocusStore {
  private readonly chains = new Map<string, Promise<void>>();
  /** 每线程下一个序号（懒初始化：首次写入时按现有行数对齐） */
  private readonly nextSeq = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly logger?: IntentFocusStoreLogger,
  ) {}

  /** 记录文件绝对路径（测试与排障用） */
  filePathOf(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'intent-focus.jsonl');
  }

  /**
   * 追加一条记录。返回 Promise 仅用于测试同步；**任何失败都不抛出**（FR-024）。
   */
  append(
    userId: string,
    agentName: string,
    threadId: string,
    draft: IntentFocusRecordDraft,
  ): Promise<void> {
    const key = `${userId}/${agentName}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doAppend(userId, agentName, threadId, key, draft));
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  /** 读取全部合法记录（仅供分析与测试；**不是**上下文组装路径） */
  readAll(userId: string, agentName: string, threadId: string): IntentFocusRecord[] {
    const file = this.filePathOf(userId, agentName, threadId);
    if (!fs.existsSync(file)) return [];
    const text = fs.readFileSync(file, 'utf8');
    const records: IntentFocusRecord[] = [];
    for (const line of text.split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        records.push(JSON.parse(line) as IntentFocusRecord);
      } catch {
        // 坏行跳过：留档文件损坏不得影响任何读取方
      }
    }
    return records;
  }

  private async doAppend(
    userId: string,
    agentName: string,
    threadId: string,
    key: string,
    draft: IntentFocusRecordDraft,
  ): Promise<void> {
    try {
      const file = this.filePathOf(userId, agentName, threadId);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const seq = this.bumpSeq(key, file);
      const record: IntentFocusRecord = {
        ...draft,
        at: draft.at ?? new Date().toISOString(),
        seq,
      };
      await fs.promises.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
      this.compactIfNeeded(file);
    } catch (err) {
      this.logger?.warn(`[intent-focus] 记录写入失败（不影响本轮对话）：${(err as Error).message}`);
    }
  }

  private bumpSeq(key: string, file: string): number {
    const current = this.nextSeq.get(key) ?? this.countLines(file) + 1;
    this.nextSeq.set(key, current + 1);
    return current;
  }

  private countLines(file: string): number {
    if (!fs.existsSync(file)) return 0;
    const text = fs.readFileSync(file, 'utf8');
    let count = 0;
    for (const line of text.split('\n')) if (line.trim().length > 0) count++;
    return count;
  }

  /** 超过上限则重写保留最近 N 条；失败只告警并保留原文件 */
  private compactIfNeeded(file: string): void {
    try {
      const size = fs.statSync(file).size;
      const lines = this.nonEmptyLines(file);
      if (size <= MAX_RECORD_BYTES && lines.length <= MAX_RECORD_LINES) return;
      const keep = lines.slice(-KEEP_RECORD_LINES);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, `${keep.join('\n')}\n`, 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      this.logger?.warn(`[intent-focus] 记录整理失败（保留原文件）：${(err as Error).message}`);
    }
  }

  private nonEmptyLines(file: string): string[] {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').filter((line) => line.trim().length > 0);
  }
}
