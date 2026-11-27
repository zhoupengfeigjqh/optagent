import fs from 'node:fs';
import path from 'node:path';
import type { IntentFocusDisposition } from './state.js';
import type { BehaviorSource } from './types.js';
import { threadDir } from '../dirs.js';

/** 单线程记录上限：字节 */
export const MAX_RECORD_BYTES = 256 * 1024;
/** 单线程记录上限：行数 */
export const MAX_RECORD_LINES = 200;
export const KEEP_RECORD_LINES = 100;

export interface SkillFocusRecord {
  name: string;
  description: string;
  is_ontology: boolean;
  ontology_id: string | null;
  score: number | null;
  selected: boolean;
  reason: string | null;
}

export interface CapabilityFocusRecord {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
  score: number | null;
  source: BehaviorSource;
  hop: number;
  via_concept: string | null;
  from_concept: string | null;
}

/**
 * 函数留档（2026-11-20）：只写**入选**函数（与行为同口径）。
 *
 * 未入选的函数不落档——记录解释的是"这轮为什么是这些内容"，不是候选明细。
 */
export interface FunctionFocusRecord {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
  score: number;
  related_concepts: string[];
}

export interface ConceptFocusRecord {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
  source: 'direct' | 'upstream';
  hop: number;
  via_concept: string | null;
  via_edges: Array<{ from: string; relation: string }>;
}

export interface RewriteFocusRecord {
  need_rewrite: boolean | null;
  rewrite_score: number | null;
  rewrite_query: string;
  rewrite_truncated: boolean;
  /** 改写耗时（毫秒）；未执行为 `null` */
  rewrite_ms: number | null;
  rewrite_history_turns: number;
  rewrite_reason: string | null;
}

/**
 * 改写字段的缺省值（**唯一来源**）。
 *
 * 两处共用：`record.ts` 铸造新记录时逐项兜底；`store.append` 面对调用方
 * 自带的 Partial draft（测试 / 分析工具）时补齐成完整记录——写入端保证
 * "落盘的每一行都有这七个键"，读取端（仅分析与测试）才不必判空。
 */
export const REWRITE_RECORD_DEFAULTS: Readonly<RewriteFocusRecord> = Object.freeze({
  need_rewrite: null,
  rewrite_score: null,
  rewrite_query: '',
  rewrite_truncated: false,
  rewrite_ms: null,
  rewrite_history_turns: 0,
  rewrite_reason: null,
});

export interface IntentFocusRecord extends RewriteFocusRecord {
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
  batches: number;
  truncated: boolean;
  depth: number;
  skills: SkillFocusRecord[];
  /** 019：提示通道的概念（直接命中 + 上游），不设上限 */
  concepts: ConceptFocusRecord[];
  behaviors: CapabilityFocusRecord[];
  tool_tip_behaviors: CapabilityFocusRecord[];
  functions: FunctionFocusRecord[];
  prompt: string;
  prompt_truncated: boolean;
  warnings: string[];
  error: string | null;
  /**
   * 028：规划门禁分数（0~1）。
   *
   * `null` = 没判（门禁关闭 / 数字人未开规划 / 判定失败或超时）。
   * 仅用于事后标定阈值与解释"这轮为什么没走规划"。
   */
  plan_score?: number | null;
  /** 028：门禁判定耗时（毫秒）；未判定为 `null` */
  plan_round_ms?: number | null;
}

export type IntentFocusRecordDraft = Omit<
  IntentFocusRecord,
  'at' | 'seq' | keyof RewriteFocusRecord
> & { at?: string } & Partial<RewriteFocusRecord>;

export interface IntentFocusStoreLogger {
  warn(msg: string): void;
}

export class IntentFocusStore {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly nextSeq = new Map<string, number>();

  constructor(
    private readonly root: string,
    private readonly logger?: IntentFocusStoreLogger,
  ) {}

  filePathOf(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'intent-focus.jsonl');
  }

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
        ...REWRITE_RECORD_DEFAULTS,
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
