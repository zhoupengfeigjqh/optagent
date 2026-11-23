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
import type { IntentFocusDisposition } from './state.js';
import type { BehaviorSource } from './types.js';
import { threadDir } from '../dirs.js';

/** 单线程记录上限：字节 */
export const MAX_RECORD_BYTES = 256 * 1024;
/** 单线程记录上限：行数 */
export const MAX_RECORD_LINES = 200;
/** 触发重写后保留的条数 */
export const KEEP_RECORD_LINES = 100;

/** 技能决策留档（含未入选者） */
export interface SkillFocusRecord {
  name: string;
  description: string;
  is_ontology: boolean;
  /** 关联本体 id；一个本体技能恒只有一个本体，非本体技能为 null */
  ontology_id: string | null;
  score: number | null;
  selected: boolean;
  reason: string | null;
}

/**
 * 行为决策留档（**只写入选行为**，2026-11-06 口径）。
 *
 * 2026-11-20：`functions` 按**入选函数**重新写入（2026-11-06 删掉的是"只写不读的常量"，
 * 这里写的是判分结果，性质不同）；取数行为并入 `behaviors` 并标 `source: 'concept_query'`。
 *
 * 2026-11-08（019）在"只写入选行为"之上补了三件事，用于解释"这条为什么会出现"：
 * - `source`：直接命中 / 上游发散 / 下游发散（发散项没有分数，`score` 为 null）；
 * - `hop`：距 direct 概念的跳数（direct 恒为 0）；
 * - `via_concept`：**所属概念**（发散项即这一跳的终点概念；direct 为行为自己的概念或 null）。
 *
 * 2026-11-13 补 `from_concept`：这一跳的**起点概念**（direct 为 null）。下游概念不落概念表，
 * 而下游多源汇聚（原材料 / 供应商 / 客户订单 都能发散到采购单），只看 `via_concept`
 * 无法判断"这条卡片项是从哪个概念发散来的"。关系名不落档：以"同一对概念之间恒有一条关系"
 * 为前提，`(from_concept, via_concept)` 唯一确定关系；该前提被打破时须补 `via_relation`。
 */
export interface CapabilityFocusRecord {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
  /** 直接命中 = Laya 分数；发散项 = null（不再判分） */
  score: number | null;
  source: BehaviorSource;
  hop: number;
  via_concept: string | null;
  /** 这一跳的起点概念；`direct` 为 null */
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
  /** 恒 > 函数阈值 */
  score: number;
  /** 依赖的概念名（取数入口） */
  related_concepts: string[];
}

/** 概念留档（019）：只有提示通道有概念，卡片通道没有 */
export interface ConceptFocusRecord {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
  /** 直接命中 / 上游发散（下游概念不进提示，因此不落这个概念表） */
  source: 'direct' | 'upstream';
  hop: number;
  via_concept: string | null;
}

/**
 * 指代改写留档字段（027）。
 *
 * 独立成一组是为了让 **`IntentFocusRecordDraft` 能把它声明为可选**：
 * 存量调用方（测试、历史早退分支）不必为了编译期齐全而逐个补七个键，
 * 而 `buildRecordDraft` 保证**新记录恒有这七个键**（缺省见 data-model §4.1）。
 */
export interface RewriteFocusRecord {
  /** 判定结论；`null` = 未执行（开关关 / 跳过 / 短路 / 未配置 / 判定失败） */
  need_rewrite: boolean | null;
  /** 单条 `noul` 分数（未执行或失败为 `null`） */
  rewrite_score: number | null;
  /** 实际送进评分的改写文本（≤100 码点）；空串 = 未改写 */
  rewrite_query: string;
  /** 改写结果是否因超 100 字被截断 */
  rewrite_truncated: boolean;
  /** 改写耗时（毫秒）；未执行为 `null` */
  rewrite_ms: number | null;
  /** 参与改写的历史问答轮数（0~2） */
  rewrite_history_turns: number;
  /** 原因枚举（见 data-model §3.1 / §3.2）；未执行且未失败为 `null` */
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

/** 一条判定记录（字段口径见 `data-model.md §4.1`） */
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
  /** 候选总数（技能 + 能力） */
  candidates: number;
  /** 本次判定实际发出的批数（`noul` 分批后：1 批 ≈ 32 题） */
  batches: number;
  /** 候选明细是否被截断 */
  truncated: boolean;
  /** 019：本轮生效的聚焦阶数（0 = 只聚焦本身） */
  depth: number;
  skills: SkillFocusRecord[];
  /** 019：提示通道的概念（直接命中 + 上游），不设上限 */
  concepts: ConceptFocusRecord[];
  /** 提示通道的行为（直接命中 + 上游发散 + 关联概念取数） */
  behaviors: CapabilityFocusRecord[];
  /** 卡片通道的行为（直接命中 + 下游发散）；**不含**函数与取数 */
  tool_tip_behaviors: CapabilityFocusRecord[];
  /** 2026-11-20：入选函数（只写入选项） */
  functions: FunctionFocusRecord[];
  prompt: string;
  prompt_truncated: boolean;
  warnings: string[];
  error: string | null;
}

/**
 * 调用方提供的字段（`at` / `seq` 由存储补齐）。
 *
 * 027：改写相关的七个键在这里**可选**——只有 `buildRecordDraft` 是权威铸造点，
 * 其它直接构造 draft 的调用方（测试、将来的分析工具）不必关心它们；
 * 由 `buildRecordDraft` 写入的记录则恒有这七个键。
 */
export type IntentFocusRecordDraft = Omit<
  IntentFocusRecord,
  'at' | 'seq' | keyof RewriteFocusRecord
> & { at?: string } & Partial<RewriteFocusRecord>;

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
