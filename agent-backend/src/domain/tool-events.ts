import fs from 'node:fs';
import path from 'node:path';
import { disposeChain } from './chain.js';
import { threadDir } from './dirs.js';
import { planSplit, planTruncatedInline, type ToolArtifactAccess } from './tool-result-split.js';
import { extractViewLinks, type ViewLink } from './view-links.js';

export type { ToolArtifactAccess } from './tool-result-split.js';

export interface ToolEventsLogger {
  warn(msg: string): void;
}

export interface ToolEventsOptions {
  root: string;
  logger?: ToolEventsLogger;
  artifacts?: (userId: string, agentName: string) => ToolArtifactAccess;
}

export interface ToolCallRecord {
  callId: string;
  messageId: string;
  name: string;
  label?: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  durationMs?: number;
  size?: number;
  content?: string;
  /** 外置正文的字节数（有值 = 临时空间里有副本，需按需拉取）。**仅外部来源（MCP）**会出现 */
  artifactSize?: number;
  /** 记录正文被截断（只保存了一部分）；`size > artifactSize` 表示副本本身也被上限截断 */
  truncated?: boolean;
  summary?: string;
  argsDigest?: Record<string, string>;
  viewLinks?: ViewLink[];
}

export interface AppendStartInput {
  callId: string;
  messageId: string;
  name: string;
  label?: string;
  startedAt: string;
  argsDigest?: Record<string, string>;
}

export interface AppendEndInput {
  callId: string;
  messageId: string;
  name: string;
  label?: string;
  startedAt: string;
  status: 'success' | 'error';
  durationMs: number;
  resultText: string;
}

interface ToolEventLine {
  call_id: string;
  message_id: string;
  name: string;
  label?: string;
  status: 'running' | 'success' | 'error';
  started_at: string;
  duration_ms?: number;
  size?: number;
  inline_content?: string;
  artifact_size?: number;
  truncated?: boolean;
  summary?: string;
  args_digest?: Record<string, string>;
  view_links?: ViewLink[];
}

export class ToolEventStore {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly artifactCache = new Map<string, ToolArtifactAccess>();

  constructor(private readonly opts: ToolEventsOptions) {}

  private filePath(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.opts.root, userId, agentName, threadId), 'tool-events.jsonl');
  }

  private access(userId: string, agentName: string): ToolArtifactAccess | undefined {
    if (!this.opts.artifacts) return undefined;
    const key = `${userId}::${agentName}`;
    let access = this.artifactCache.get(key);
    if (!access) {
      access = this.opts.artifacts(userId, agentName);
      this.artifactCache.set(key, access);
    }
    return access;
  }

  appendStart(userId: string, agentName: string, threadId: string, input: AppendStartInput): void {
    const line: ToolEventLine = {
      call_id: input.callId,
      message_id: input.messageId,
      name: input.name,
      ...(input.label !== undefined && input.label !== '' ? { label: input.label } : {}),
      status: 'running',
      started_at: input.startedAt,
      ...(input.argsDigest ? { args_digest: input.argsDigest } : {}),
    };
    void this.enqueueTask(userId, agentName, threadId, () =>
      this.doAppend(userId, agentName, threadId, JSON.stringify(line)),
    ).catch(() => {});
  }

  appendEnd(
    userId: string,
    agentName: string,
    threadId: string,
    input: AppendEndInput,
  ): Promise<void> {
    return this.enqueueTask(userId, agentName, threadId, async () => {
      const line: ToolEventLine = {
        call_id: input.callId,
        message_id: input.messageId,
        name: input.name,
        ...(input.label !== undefined && input.label !== '' ? { label: input.label } : {}),
        status: input.status,
        started_at: input.startedAt,
        duration_ms: input.durationMs,
        size: Buffer.byteLength(input.resultText, 'utf8'),
      };
      const viewLinks = extractViewLinks(input.resultText);
      if (viewLinks) line.view_links = viewLinks;
      await this.splitResult(userId, agentName, threadId, input, line);
      await this.doAppend(userId, agentName, threadId, JSON.stringify(line));
    }).catch((err: unknown) => {
      this.opts.logger?.warn(
        `tool-events 落盘失败（user=${userId} agent=${agentName} thread=${threadId} call=${input.callId}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  private async splitResult(
    userId: string,
    agentName: string,
    threadId: string,
    input: AppendEndInput,
    line: ToolEventLine,
  ): Promise<void> {
    const size = line.size ?? Buffer.byteLength(input.resultText, 'utf8');
    const access = this.access(userId, agentName);
    const plan = planSplit({
      name: line.name,
      resultText: input.resultText,
      size,
      canArtifact: access !== undefined,
      threadId,
      callId: input.callId,
    });

    if (plan.inlineContent !== undefined) line.inline_content = plan.inlineContent;
    if (plan.truncated !== undefined) line.truncated = plan.truncated;
    if (plan.summary !== undefined) line.summary = plan.summary;
    if (!plan.artifact || !access) return;

    try {
      await access.write(threadId, plan.artifact.filename, plan.artifact.content);
      line.artifact_size = plan.artifact.size;
    } catch (err: unknown) {
      this.opts.logger?.warn(
        `tool-events 外置正文写入失败，退化为截断内联（agent=${agentName} thread=${threadId} call=${input.callId}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      // 副本没写成：正文换成"未保存"版（不能给一个不存在的路径），摘要随之无意义
      const fallback = planTruncatedInline(input.resultText, size);
      if (fallback.inlineContent !== undefined) line.inline_content = fallback.inlineContent;
      line.truncated = true;
      delete line.summary;
    }
  }

  private enqueueTask(
    userId: string,
    agentName: string,
    threadId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const key = `${userId}/${agentName}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task);
    this.chains.set(
      key,
      next.catch(() => {}),
    );
    return next;
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

  /**
   * 等待该会话当前已排队的落盘链完成（优雅关闭与测试用）。
   *
   * `appendStart` 是 fire-and-forget，没有返回值；需要"确保已写盘"的场景
   * （关机收尾、测试断言）用本方法显式等待，而不是猜一个 sleep 时长。
   * 链内含**外置正文写入**（见 appendEnd），因此返回即代表记录与产物都已就绪。
   */
  flush(userId: string, agentName: string, threadId: string): Promise<void> {
    return this.chains.get(`${userId}/${agentName}/${threadId}`) ?? Promise.resolve();
  }

  /**
   * 释放该会话的串行链内存（2026-10-27）：删会话时调用，等链排空后删键。
   * 安全性见 `disposeChain`（期间有新写入则保留不动）。
   */
  disposeThread(userId: string, agentName: string, threadId: string): Promise<void> {
    return disposeChain(this.chains, `${userId}/${agentName}/${threadId}`);
  }

  readAll(userId: string, agentName: string, threadId: string): ToolCallRecord[] {
    const merged = new Map<string, ToolCallRecord>();
    for (const line of this.readLines(userId, agentName, threadId)) {
      const incoming = toRecord(line);
      const exist = merged.get(line.call_id);
      if (!exist) {
        merged.set(line.call_id, incoming);
        continue;
      }
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined) (exist as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return [...merged.values()];
  }

  readByMessage(
    userId: string,
    agentName: string,
    threadId: string,
  ): Map<string, ToolCallRecord[]> {
    const grouped = new Map<string, ToolCallRecord[]>();
    for (const record of this.readAll(userId, agentName, threadId)) {
      const list = grouped.get(record.messageId);
      if (list) list.push(record);
      else grouped.set(record.messageId, [record]);
    }
    return grouped;
  }

  private readLines(userId: string, agentName: string, threadId: string): ToolEventLine[] {
    const file = this.filePath(userId, agentName, threadId);
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim() !== '');
    const parsed: ToolEventLine[] = [];
    let bad = 0;
    for (const line of lines) {
      const obj = parseLine(line);
      if (obj) parsed.push(obj);
      else bad++;
    }
    if (bad > 0) {
      this.opts.logger?.warn(
        `tool-events 坏行跳过 ${bad} 条（user=${userId} agent=${agentName} thread=${threadId}）`,
      );
    }
    if (lines.length > 0 && parsed.length === 0) {
      const backup = path.join(path.dirname(file), `tool-events.corrupt-${Date.now()}.jsonl`);
      try {
        fs.renameSync(file, backup);
        fs.writeFileSync(file, '', 'utf8');
        this.opts.logger?.warn(
          `tool-events 整体损坏，已备份至 ${backup} 并重建（user=${userId} agent=${agentName} thread=${threadId}）`,
        );
      } catch {
        // 备份失败不影响本次读取
      }
    }
    return parsed;
  }
}

function toRecord(line: ToolEventLine): ToolCallRecord {
  const record: ToolCallRecord = {
    callId: line.call_id,
    messageId: line.message_id,
    name: line.name,
    status: line.status,
    startedAt: line.started_at,
  };
  if (typeof line.label === 'string' && line.label !== '') record.label = line.label;
  if (typeof line.duration_ms === 'number') record.durationMs = line.duration_ms;
  if (typeof line.size === 'number') record.size = line.size;
  if (typeof line.inline_content === 'string') record.content = line.inline_content;
  if (typeof line.artifact_size === 'number') record.artifactSize = line.artifact_size;
  if (typeof line.truncated === 'boolean') record.truncated = line.truncated;
  if (typeof line.summary === 'string') record.summary = line.summary;
  if (isStringMap(line.args_digest)) record.argsDigest = line.args_digest;
  if (line.view_links !== undefined && line.view_links.length > 0)
    record.viewLinks = line.view_links;
  return record;
}

function parseLine(line: string): ToolEventLine | undefined {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (
    typeof obj.call_id !== 'string' ||
    typeof obj.message_id !== 'string' ||
    typeof obj.name !== 'string' ||
    typeof obj.started_at !== 'string' ||
    (obj.status !== 'running' && obj.status !== 'success' && obj.status !== 'error')
  ) {
    return undefined;
  }
  const out: ToolEventLine = {
    call_id: obj.call_id,
    message_id: obj.message_id,
    name: obj.name,
    status: obj.status,
    started_at: obj.started_at,
  };
  if (typeof obj.label === 'string' && obj.label !== '') out.label = obj.label;
  if (typeof obj.duration_ms === 'number') out.duration_ms = obj.duration_ms;
  if (typeof obj.size === 'number') out.size = obj.size;
  if (typeof obj.inline_content === 'string') out.inline_content = obj.inline_content;
  if (typeof obj.artifact_size === 'number') out.artifact_size = obj.artifact_size;
  if (typeof obj.truncated === 'boolean') out.truncated = obj.truncated;
  if (typeof obj.summary === 'string') out.summary = obj.summary;
  if (isStringMap(obj.args_digest)) out.args_digest = obj.args_digest;
  const viewLinks = parseViewLinks(obj.view_links);
  if (viewLinks) out.view_links = viewLinks;
  return out;
}

function parseViewLinks(value: unknown): ViewLink[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const out: ViewLink[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const { url, name, kind } = item as { url?: unknown; name?: unknown; kind?: unknown };
    if (typeof url !== 'string' || url === '') continue;
    const link: ViewLink = kind === 'file' ? { url, kind: 'file' } : { url };
    if (typeof name === 'string' && name !== '') link.name = name;
    out.push(link);
  }
  return out.length > 0 ? out : undefined;
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}
