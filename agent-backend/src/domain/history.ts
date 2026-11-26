import fs from 'node:fs';
import path from 'node:path';
import type { FeedbackValue, HistoryMessage } from '../types.js';
import { disposeChain } from './chain.js';
import { threadDir } from './dirs.js';

export interface HistoryLogger {
  warn(msg: string): void;
}

type ParsedLine =
  | { kind: 'message'; message: HistoryMessage }
  | { kind: 'feedback'; messageId: string; value: FeedbackValue };

export class HistoryStore {
  private readonly chains = new Map<string, Promise<void>>();

  constructor(
    private readonly root: string,
    private readonly logger?: HistoryLogger,
  ) {}

  private filePath(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'history.jsonl');
  }

  append(userId: string, agentName: string, threadId: string, msg: HistoryMessage): Promise<void> {
    return this.enqueue(userId, agentName, threadId, JSON.stringify(msg));
  }

  appendFeedback(
    userId: string,
    agentName: string,
    threadId: string,
    messageId: string,
    value: FeedbackValue,
  ): Promise<void> {
    const line = JSON.stringify({
      type: 'feedback',
      message_id: messageId,
      value,
      ts: new Date().toISOString(),
    });
    return this.enqueue(userId, agentName, threadId, line);
  }

  private enqueue(
    userId: string,
    agentName: string,
    threadId: string,
    line: string,
  ): Promise<void> {
    const key = `${userId}/${agentName}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.doAppend(userId, agentName, threadId, line));
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
  }

  /**
   * 释放该会话的串行链内存（2026-10-27）：删会话时调用，等链排空后删键。
   * 语义与安全性见 `disposeChain` 的注释（期间有新写入则保留不动）。
   */
  disposeThread(userId: string, agentName: string, threadId: string): Promise<void> {
    return disposeChain(this.chains, `${userId}/${agentName}/${threadId}`);
  }

  private async doAppend(
    userId: string,
    agentName: string,
    threadId: string,
    line: string,
  ): Promise<void> {
    const file = this.filePath(userId, agentName, threadId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await fs.promises.appendFile(file, line + '\n', 'utf8');
  }

  private readLines(userId: string, agentName: string, threadId: string): ParsedLine[] {
    const file = this.filePath(userId, agentName, threadId);
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
      this.logger?.warn(
        `history 坏行跳过 ${bad} 条（user=${userId} agent=${agentName} thread=${threadId}）`,
      );
    }
    if (lines.length > 0 && parsed.length === 0) {
      const backup = path.join(path.dirname(file), `history.corrupt-${Date.now()}.jsonl`);
      fs.renameSync(file, backup);
      fs.writeFileSync(file, '', 'utf8');
      this.logger?.warn(
        `history 整体损坏，已备份至 ${backup} 并重建（user=${userId} agent=${agentName} thread=${threadId}）`,
      );
    }
    return parsed;
  }

  readAll(userId: string, agentName: string, threadId: string): HistoryMessage[] {
    return this.readLines(userId, agentName, threadId)
      .filter((p): p is Extract<ParsedLine, { kind: 'message' }> => p.kind === 'message')
      .map((p) => p.message);
  }

  readSnapshot(
    userId: string,
    agentName: string,
    threadId: string,
  ): { messages: HistoryMessage[]; feedback: Map<string, 'up' | 'down'> } {
    const messages: HistoryMessage[] = [];
    const feedback = new Map<string, 'up' | 'down'>();
    for (const p of this.readLines(userId, agentName, threadId)) {
      if (p.kind === 'message') {
        messages.push(p.message);
      } else if (p.value === null) {
        feedback.delete(p.messageId);
      } else {
        feedback.set(p.messageId, p.value);
      }
    }
    return { messages, feedback };
  }

  readRecent(userId: string, agentName: string, threadId: string, n: number): HistoryMessage[] {
    return this.readAll(userId, agentName, threadId).slice(-n);
  }

  readFeedback(userId: string, agentName: string, threadId: string): Map<string, 'up' | 'down'> {
    const map = new Map<string, 'up' | 'down'>();
    for (const p of this.readLines(userId, agentName, threadId)) {
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
    return undefined;
  }

  if (obj.type === 'feedback') {
    const messageId = obj.message_id;
    const value = obj.value;
    if (typeof messageId === 'string' && (value === 'up' || value === 'down' || value === null)) {
      return { kind: 'feedback', messageId, value };
    }
    return undefined;
  }

  if ((obj.role !== 'user' && obj.role !== 'assistant') || typeof obj.content !== 'string') {
    return undefined;
  }
  const msg: HistoryMessage = { role: obj.role, content: obj.content };
  if (typeof obj.id === 'string') msg.id = obj.id;
  if (typeof obj.ts === 'string') msg.ts = obj.ts;
  if (obj.status === 'completed' || obj.status === 'failed') msg.status = obj.status;
  if (isUsage(obj.usage))
    msg.usage = { input_tokens: obj.usage.input_tokens, output_tokens: obj.usage.output_tokens };
  if (typeof obj.duration_ms === 'number') msg.duration_ms = obj.duration_ms;
  if (typeof obj.agent_name === 'string') msg.agent_name = obj.agent_name;
  if (Array.isArray(obj.attachments)) {
    const atts = obj.attachments.filter(
      (a): a is { dir: string; filename: string } =>
        typeof a === 'object' &&
        a !== null &&
        typeof (a as { dir?: unknown }).dir === 'string' &&
        typeof (a as { filename?: unknown }).filename === 'string',
    );
    if (atts.length > 0) msg.attachments = atts;
  }
  if (isErrorMeta(obj.error)) msg.error = { code: obj.error.code, message: obj.error.message };
  if (typeof obj.skill === 'string' && obj.skill !== '') msg.skill = obj.skill;
  return { kind: 'message', message: msg };
}

function isUsage(u: unknown): u is { input_tokens: number; output_tokens: number } {
  return (
    typeof u === 'object' &&
    u !== null &&
    typeof (u as { input_tokens?: unknown }).input_tokens === 'number' &&
    typeof (u as { output_tokens?: unknown }).output_tokens === 'number'
  );
}

function isErrorMeta(e: unknown): e is { code: string; message: string } {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}
