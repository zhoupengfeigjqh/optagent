/**
 * history.jsonl 读写（FR-009/019/029 + 002 特性：消息元数据与反馈）。
 *
 * - 行格式两类：消息行（HistoryMessage：role/content + 可选元数据 id/ts/status/usage/
 *   duration_ms/attachments/error）与反馈行（{type:'feedback', message_id, value, ts}）
 * - 不落思考内容与工具调用信息：解析时白名单复制字段，未知字段一律丢弃
 * - 旧格式行（仅 role/content）兼容可读；反馈行不出现在 readAll/readRecent 结果中
 * - 追加经 per-thread Promise 链串行化，并发安全；单行一次 append 保证原子性
 * - 读取时坏行跳过并告警；整体损坏（无一条合法行）→ 备份后重建并告警
 */
import fs from 'node:fs';
import path from 'node:path';
import type { FeedbackValue, HistoryMessage } from '../types.js';
import { threadDir } from './dirs.js';

export interface HistoryLogger {
  warn(msg: string): void;
}

type ParsedLine = { kind: 'message'; message: HistoryMessage } | { kind: 'feedback'; messageId: string; value: FeedbackValue };

export class HistoryStore {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly logger?: HistoryLogger,
  ) {}

  private filePath(userId: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, threadId), 'history.jsonl');
  }

  /** 追加一条消息（per-thread 串行；写盘失败抛给调用方记录，不影响已广播的响应） */
  append(userId: string, threadId: string, msg: HistoryMessage): Promise<void> {
    return this.enqueue(userId, threadId, JSON.stringify(msg));
  }

  /** 追加反馈行（value=null 表示取消反馈；合并语义见 readFeedback） */
  appendFeedback(userId: string, threadId: string, messageId: string, value: FeedbackValue): Promise<void> {
    const line = JSON.stringify({ type: 'feedback', message_id: messageId, value, ts: new Date().toISOString() });
    return this.enqueue(userId, threadId, line);
  }

  private enqueue(userId: string, threadId: string, line: string): Promise<void> {
    const key = `${userId}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doAppend(userId, threadId, line));
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  private async doAppend(userId: string, threadId: string, line: string): Promise<void> {
    const file = this.filePath(userId, threadId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, line + '\n', 'utf8');
  }

  /** 读取文件全部合法行（消息 + 反馈）；坏行跳过告警，整体损坏备份重建（FR-029） */
  private readLines(userId: string, threadId: string): ParsedLine[] {
    const file = this.filePath(userId, threadId);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const parsed: ParsedLine[] = [];
    let bad = 0;
    for (const line of lines) {
      const p = parseLine(line);
      if (p) parsed.push(p);
      else bad++;
    }
    if (bad > 0) {
      this.logger?.warn(`history 坏行跳过 ${bad} 条（user=${userId} thread=${threadId}）`);
    }
    if (lines.length > 0 && parsed.length === 0) {
      // 整体损坏：备份原文件并重建为空
      const backup = path.join(path.dirname(file), `history.corrupt-${Date.now()}.jsonl`);
      fs.renameSync(file, backup);
      fs.writeFileSync(file, '', 'utf8');
      this.logger?.warn(`history 整体损坏，已备份至 ${backup} 并重建（user=${userId} thread=${threadId}）`);
    }
    return parsed;
  }

  /** 读取全部消息（反馈行被过滤）；时间正序 */
  readAll(userId: string, threadId: string): HistoryMessage[] {
    return this.readLines(userId, threadId)
      .filter((p): p is Extract<ParsedLine, { kind: 'message' }> => p.kind === 'message')
      .map((p) => p.message);
  }

  /**
   * 单次读盘同时取回「消息 + 反馈」。
   *
   * 详情接口原先分别调用 `readAll` 与 `readFeedback`，会把同一份 history.jsonl
   * 读盘并解析两遍；本方法合并为一次遍历，语义与两者逐条等价。
   */
  readSnapshot(
    userId: string,
    threadId: string,
  ): { messages: HistoryMessage[]; feedback: Map<string, 'up' | 'down'> } {
    const messages: HistoryMessage[] = [];
    const feedback = new Map<string, 'up' | 'down'>();
    for (const p of this.readLines(userId, threadId)) {
      if (p.kind === 'message') {
        messages.push(p.message);
      } else if (p.value === null) {
        feedback.delete(p.messageId); // 取消反馈：从结果中移除
      } else {
        feedback.set(p.messageId, p.value);
      }
    }
    return { messages, feedback };
  }

  /** 最近 N 条消息（时间正序，供 LLM 上下文；不含反馈行） */
  readRecent(userId: string, threadId: string, n: number): HistoryMessage[] {
    return this.readAll(userId, threadId).slice(-n);
  }

  /** 反馈合并：按行序后者覆盖前者；value=null 视为无反馈（从结果中移除） */
  readFeedback(userId: string, threadId: string): Map<string, 'up' | 'down'> {
    const map = new Map<string, 'up' | 'down'>();
    for (const p of this.readLines(userId, threadId)) {
      if (p.kind !== 'feedback') continue;
      if (p.value === null) map.delete(p.messageId);
      else map.set(p.messageId, p.value);
    }
    return map;
  }
}

function parseLine(line: string): ParsedLine | undefined {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined; // 坏行
  }

  // 反馈行
  if (obj.type === 'feedback') {
    const messageId = obj.message_id;
    const value = obj.value;
    if (typeof messageId === 'string' && (value === 'up' || value === 'down' || value === null)) {
      return { kind: 'feedback', messageId, value };
    }
    return undefined;
  }

  // 消息行：白名单复制字段（思考内容/工具信息即使存在也被丢弃，FR-009）
  if ((obj.role !== 'user' && obj.role !== 'assistant') || typeof obj.content !== 'string') {
    return undefined;
  }
  const msg: HistoryMessage = { role: obj.role, content: obj.content };
  if (typeof obj.id === 'string') msg.id = obj.id;
  if (typeof obj.ts === 'string') msg.ts = obj.ts;
  if (obj.status === 'completed' || obj.status === 'failed') msg.status = obj.status;
  if (isUsage(obj.usage)) msg.usage = { input_tokens: obj.usage.input_tokens, output_tokens: obj.usage.output_tokens };
  if (typeof obj.duration_ms === 'number') msg.duration_ms = obj.duration_ms;
  if (typeof obj.agent_name === 'string') msg.agent_name = obj.agent_name;
  if (Array.isArray(obj.attachments)) {
    const atts = obj.attachments.filter(
      (a): a is { dir: string; filename: string } =>
        typeof a === 'object' && a !== null &&
        typeof (a as { dir?: unknown }).dir === 'string' &&
        typeof (a as { filename?: unknown }).filename === 'string',
    );
    if (atts.length > 0) msg.attachments = atts;
  }
  if (isErrorMeta(obj.error)) msg.error = { code: obj.error.code, message: obj.error.message };
  return { kind: 'message', message: msg };
}

function isUsage(u: unknown): u is { input_tokens: number; output_tokens: number } {
  return (
    typeof u === 'object' && u !== null &&
    typeof (u as { input_tokens?: unknown }).input_tokens === 'number' &&
    typeof (u as { output_tokens?: unknown }).output_tokens === 'number'
  );
}

function isErrorMeta(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' && e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}
