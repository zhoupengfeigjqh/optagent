/**
 * 一轮聚焦的留档写入（016）。
 *
 * 从 runner 拆出（宪章原则二：单文件 ≤500 行）：runner 只负责"怎么判定"，
 * 本文件只负责"怎么把结论写成一条记录"，两者可以独立测试与演进。
 *
 * 写入失败只告警，绝不影响对话（FR-054）；store 内部已有兜底，这里是第二道防线。
 */
import type { IntentFocusDisposition } from './state.js';
import type { IntentFocusRecordDraft } from './store.js';
import { buildRecordDraft, type ConceptEntry } from './record.js';
import type {
  CapabilitySelection,
  ExpandedBehavior,
  SkillDecision,
} from './types.js';

/** 一条记录的字段（避免每个分支都重复写十余个键） */
export interface RecordFields {
  disposition: IntentFocusDisposition;
  reason: string | null;
  model: string | null;
  roundMs: number | null;
  candidateCount: number;
  batches: number;
  truncated: boolean;
  skills: readonly SkillDecision[];
  capabilities: CapabilitySelection;
  prompt: string;
  promptTruncated: boolean;
  warnings: readonly string[];
  error: string | null;
  /**
   * 019：以下四项缺省即可——空结果 / 降级 / 跳过分支没有发散，
   * 让调用方只在"已聚焦"分支里补写，避免每个早退分支都抄一遍。
   */
  depth?: number;
  concepts?: readonly ConceptEntry[];
  upstreamBehaviors?: readonly ExpandedBehavior[];
  downstreamBehaviors?: readonly ExpandedBehavior[];
}

export interface FocusRecordWriterLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface FocusRecordWriterDeps {
  /** 缺省 = 未装配 → 不落记录 */
  store?: {
    append(
      userId: string,
      agentName: string,
      threadId: string,
      draft: IntentFocusRecordDraft,
    ): Promise<void>;
  };
  logger?: FocusRecordWriterLogger;
}

/** 记录归属（与一次 `judge` 调用一一对应） */
export interface RecordTarget {
  userId: string;
  agentName: string;
  threadId: string;
  messageId: string | null;
}

export class FocusRecordWriter {
  constructor(private readonly deps: FocusRecordWriterDeps) {}

  async write(
    target: RecordTarget,
    state: string,
    inputTruncated: boolean,
    fields: RecordFields,
  ): Promise<void> {
    const store = this.deps.store;
    if (!store) return;
    const draft = buildRecordDraft({
      threadId: target.threadId,
      agentName: target.agentName,
      messageId: target.messageId,
      input: state,
      inputTruncated,
      disposition: fields.disposition,
      reason: fields.reason,
      model: fields.model,
      roundMs: fields.roundMs,
      candidateCount: fields.candidateCount,
      batches: fields.batches,
      truncated: fields.truncated,
      depth: fields.depth ?? 0,
      skills: fields.skills,
      capabilities: fields.capabilities,
      concepts: fields.concepts ?? [],
      upstreamBehaviors: fields.upstreamBehaviors ?? [],
      downstreamBehaviors: fields.downstreamBehaviors ?? [],
      prompt: fields.prompt,
      promptTruncated: fields.promptTruncated,
      warnings: fields.warnings,
      error: fields.error,
    });
    try {
      await store.append(target.userId, target.agentName, target.threadId, draft);
    } catch (err) {
      this.deps.logger?.warn(
        {
          event: 'intent-focus.record.failed',
          alert: true,
          stage: 'record',
          reason: 'record_failed',
          thread_id: target.threadId,
          agent_name: target.agentName,
        },
        `意图聚焦记录写入失败：${(err as Error).message}`,
      );
    }
  }
}
