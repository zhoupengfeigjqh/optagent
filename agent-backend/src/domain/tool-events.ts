/**
 * 工具调用记录存储（002 特性：tool-events.jsonl）。
 *
 * 落点与生命周期（与 history.jsonl 同层的**会话私有数据**）：
 * - `threads/{thread_id}/tool-events.jsonl`：一行一次事件（start 记 running、
 *   end 记终态），读取时按 `call_id` 合并（后者覆盖前者，与反馈行同语义）
 * - 结果 ≤ 内联阈值：原文存本行 `inline_content`
 * - 结果 > 内联阈值：正文外置到「临时空间/{thread_id}_toolresult_{call_id}.txt」，
 *   本行只记 `artifact_size` + `summary`（**不记路径**，读取时按同一函数重算）
 *
 * 与 history.jsonl 一致的口径：
 * - 追加经 per-thread Promise 链串行化；单行一次 append 保证原子性
 * - 坏行跳过并告警；整体损坏（无一条合法行）→ 备份后重建并告警
 * - 读取白名单复制字段，未知字段丢弃
 *
 * 与 history.jsonl 不同的口径：
 * - 本文件**参与上下文回灌**（见 tool-context）：短结果原文按预算拼进 messages，
 *   外置结果只在 systemPrompt 留一行索引——因此它不属于"不落历史"的范畴
 */
import fs from 'node:fs';
import path from 'node:path';
import { SPACE_TMP, threadDir } from './dirs.js';
import {
  TOOL_ARTIFACT_MAX_BYTES,
  TOOL_INLINE_MAX_BYTES,
  artifactFileName,
  summarizeResult,
  truncateToBytes,
} from './tool-result.js';

/** 外置正文的读写口（装配层用 FileAccess 实现；缺省时超阈值结果退化为截断内联） */
export interface ToolArtifactAccess {
  /** 写临时空间文件（文件名须 `{threadId}_` 前缀，由 FileAccess 强制） */
  write(threadId: string, filename: string, content: string): Promise<string>;
  /** 校验并定位（白名单 + 符号链接 + 存在性）；读取方自行 readFile */
  resolveVerified(relPath: string): { relPath: string; abs: string };
}

export interface ToolEventsLogger {
  warn(msg: string): void;
}

export interface ToolEventsOptions {
  root: string;
  logger?: ToolEventsLogger;
  /** 按用户取外置正文读写口（缺省 = 不支持外置，超阈值结果截断内联） */
  artifacts?: (userId: string) => ToolArtifactAccess;
}

/** 对外投影的工具调用记录（接口层再映射为 snake_case 契约） */
export interface ToolCallRecord {
  callId: string;
  /** 该轮 assistant 消息 id（前端据此把卡片挂到对应气泡） */
  messageId: string;
  name: string;
  status: 'running' | 'success' | 'error';
  startedAt: string;
  durationMs?: number;
  /** 结果字节数（结果产生后才有） */
  size?: number;
  /** 内联正文（结果未外置时） */
  content?: string;
  /** 外置正文的字节数（有值 = 正文在临时空间，需按需拉取） */
  artifactSize?: number;
  truncated?: boolean;
  /** 规则提取的摘要（外置结果的索引行与卡片标题用） */
  summary?: string;
  /** 入参短标量摘要（原文不落盘） */
  argsDigest?: Record<string, string>;
}

export interface AppendStartInput {
  callId: string;
  messageId: string;
  name: string;
  startedAt: string;
  argsDigest?: Record<string, string>;
}

export interface AppendEndInput {
  callId: string;
  messageId: string;
  name: string;
  startedAt: string;
  status: 'success' | 'error';
  durationMs: number;
  /** 已序列化的结果文本（见 tool-result.serializeToolResult） */
  resultText: string;
}

/** JSONL 单行（落盘格式） */
interface ToolEventLine {
  call_id: string;
  message_id: string;
  name: string;
  status: 'running' | 'success' | 'error';
  started_at: string;
  duration_ms?: number;
  size?: number;
  inline_content?: string;
  artifact_size?: number;
  truncated?: boolean;
  summary?: string;
  args_digest?: Record<string, string>;
}

export class ToolEventStore {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly artifactCache = new Map<string, ToolArtifactAccess>();

  constructor(private readonly opts: ToolEventsOptions) {}

  private filePath(userId: string, threadId: string): string {
    return path.join(threadDir(this.opts.root, userId, threadId), 'tool-events.jsonl');
  }

  private access(userId: string): ToolArtifactAccess | undefined {
    if (!this.opts.artifacts) return undefined;
    let access = this.artifactCache.get(userId);
    if (!access) {
      access = this.opts.artifacts(userId);
      this.artifactCache.set(userId, access);
    }
    return access;
  }

  /** 记一次调用开始（fire-and-forget：写盘失败不影响对话） */
  appendStart(userId: string, threadId: string, input: AppendStartInput): void {
    const line: ToolEventLine = {
      call_id: input.callId,
      message_id: input.messageId,
      name: input.name,
      status: 'running',
      started_at: input.startedAt,
      ...(input.argsDigest ? { args_digest: input.argsDigest } : {}),
    };
    void this.enqueueTask(userId, threadId, () =>
      this.doAppend(userId, threadId, JSON.stringify(line)),
    ).catch(() => {});
  }

  /**
   * 记一次调用结束（含体积分流）。
   *
   * **整个"分流 + 写盘"作为同一个任务进链**——外置正文的写入也在链内，
   * 否则 `flush` 只等到 JSONL 追加、等不到外置文件，`done` 广播后前端
   * 立即刷新就会读到"有记录但正文缺失"的中间态。
   *
   * 生产路径 **fire-and-forget**（void 调用方）：落盘失败 MUST NOT 影响
   * 已广播给用户的回答（原则九：降级不阻断）。
   */
  appendEnd(userId: string, threadId: string, input: AppendEndInput): Promise<void> {
    return this.enqueueTask(userId, threadId, async () => {
      const line: ToolEventLine = {
        call_id: input.callId,
        message_id: input.messageId,
        name: input.name,
        status: input.status,
        started_at: input.startedAt,
        duration_ms: input.durationMs,
        size: Buffer.byteLength(input.resultText, 'utf8'),
      };
      await this.splitResult(userId, threadId, input, line);
      await this.doAppend(userId, threadId, JSON.stringify(line));
    }).catch((err: unknown) => {
      this.opts.logger?.warn(
        `tool-events 落盘失败（user=${userId} thread=${threadId} call=${input.callId}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
  }

  /** 体积分流：≤ 内联阈值存原文；> 阈值外置正文（外置失败则退化为截断内联） */
  private async splitResult(
    userId: string,
    threadId: string,
    input: AppendEndInput,
    line: ToolEventLine,
  ): Promise<void> {
    if (line.size !== undefined && line.size <= TOOL_INLINE_MAX_BYTES) {
      line.inline_content = input.resultText;
      return;
    }
    const bounded = truncateToBytes(input.resultText, TOOL_ARTIFACT_MAX_BYTES);
    line.truncated = bounded.truncated;
    line.summary = summarizeResult(bounded.text);
    const access = this.access(userId);
    if (!access) {
      // 未装配外置能力：降级为截断内联（不丢记录，只丢超长部分）
      const fallback = truncateToBytes(input.resultText, TOOL_INLINE_MAX_BYTES);
      line.inline_content = fallback.text;
      line.truncated = true;
      line.size = Buffer.byteLength(fallback.text, 'utf8');
      return;
    }
    try {
      const filename = artifactFileName(threadId, input.callId);
      await access.write(threadId, filename, bounded.text);
      line.artifact_size = Buffer.byteLength(bounded.text, 'utf8');
      line.size = line.artifact_size;
    } catch (err: unknown) {
      this.opts.logger?.warn(
        `tool-events 外置正文写入失败，退化为截断内联（thread=${threadId} call=${input.callId}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      const fallback = truncateToBytes(input.resultText, TOOL_INLINE_MAX_BYTES);
      line.inline_content = fallback.text;
      line.truncated = true;
      line.size = Buffer.byteLength(fallback.text, 'utf8');
    }
  }

  /** 把一个任务排进该会话的串行链（前一个失败不阻塞后一个） */
  private enqueueTask(
    userId: string,
    threadId: string,
    task: () => Promise<void>,
  ): Promise<void> {
    const key = `${userId}/${threadId}`;
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.then(task);
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

  /**
   * 等待该会话当前已排队的落盘链完成（优雅关闭与测试用）。
   *
   * `appendStart` 是 fire-and-forget，没有返回值；需要"确保已写盘"的场景
   * （关机收尾、测试断言）用本方法显式等待，而不是猜一个 sleep 时长。
   * 链内含**外置正文写入**（见 appendEnd），因此返回即代表记录与产物都已就绪。
   */
  flush(userId: string, threadId: string): Promise<void> {
    return this.chains.get(`${userId}/${threadId}`) ?? Promise.resolve();
  }

  /** 读取全部记录（按 call_id 合并、保持首次出现顺序）；时间正序 */
  readAll(userId: string, threadId: string): ToolCallRecord[] {
    const merged = new Map<string, ToolCallRecord>();
    for (const line of this.readLines(userId, threadId)) {
      const incoming = toRecord(line);
      const exist = merged.get(line.call_id);
      if (!exist) {
        merged.set(line.call_id, incoming);
        continue;
      }
      // 后者覆盖前者：仅覆盖"本行提供了值"的字段（running 行不携带终态字段）
      for (const [k, v] of Object.entries(incoming)) {
        if (v !== undefined) (exist as unknown as Record<string, unknown>)[k] = v;
      }
    }
    return [...merged.values()];
  }

  /** 按 assistant 消息分组（详情接口挂卡片用） */
  readByMessage(userId: string, threadId: string): Map<string, ToolCallRecord[]> {
    const grouped = new Map<string, ToolCallRecord[]>();
    for (const record of this.readAll(userId, threadId)) {
      const list = grouped.get(record.messageId);
      if (list) list.push(record);
      else grouped.set(record.messageId, [record]);
    }
    return grouped;
  }

  /**
   * 读取外置正文全文。
   *
   * 路径由 `{threadId, callId}` **重新推导**（不读事件行里的任何路径），
   * 因此数据被篡改也无法越权；`resolveVerified` 再兜一层白名单校验。
   * 返回 undefined 表示文件已不存在（过期清理或用户删除）。
   */
  async readArtifact(
    userId: string,
    threadId: string,
    callId: string,
  ): Promise<{ content: string; size: number } | undefined> {
    const access = this.access(userId);
    if (!access) return undefined;
    const relPath = `${SPACE_TMP}/${artifactFileName(threadId, callId)}`;
    let abs: string;
    try {
      abs = access.resolveVerified(relPath).abs;
    } catch {
      return undefined;
    }
    try {
      const buf = await fs.promises.readFile(abs);
      // 读取即刷新访问时间：临时空间 7 天清理以"最近访问"为准，看过的结果不会被误回收
      const now = new Date();
      await fs.promises.utimes(abs, now, now).catch(() => {});
      return { content: buf.toString('utf8'), size: buf.length };
    } catch {
      return undefined;
    }
  }

  /** 读取文件全部合法行；坏行跳过告警，整体损坏备份重建（与 history.jsonl 同口径） */
  private readLines(userId: string, threadId: string): ToolEventLine[] {
    const file = this.filePath(userId, threadId);
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
      this.opts.logger?.warn(`tool-events 坏行跳过 ${bad} 条（user=${userId} thread=${threadId}）`);
    }
    if (lines.length > 0 && parsed.length === 0) {
      const backup = path.join(
        path.dirname(file),
        `tool-events.corrupt-${Date.now()}.jsonl`,
      );
      try {
        fs.renameSync(file, backup);
        fs.writeFileSync(file, '', 'utf8');
        this.opts.logger?.warn(
          `tool-events 整体损坏，已备份至 ${backup} 并重建（user=${userId} thread=${threadId}）`,
        );
      } catch {
        /* 备份失败：保持原文件不动，下次读取继续告警 */
      }
    }
    return parsed;
  }
}

/** 行 → 记录（白名单复制：未知字段一律丢弃） */
function toRecord(line: ToolEventLine): ToolCallRecord {
  const record: ToolCallRecord = {
    callId: line.call_id,
    messageId: line.message_id,
    name: line.name,
    status: line.status,
    startedAt: line.started_at,
  };
  if (typeof line.duration_ms === 'number') record.durationMs = line.duration_ms;
  if (typeof line.size === 'number') record.size = line.size;
  if (typeof line.inline_content === 'string') record.content = line.inline_content;
  if (typeof line.artifact_size === 'number') record.artifactSize = line.artifact_size;
  if (typeof line.truncated === 'boolean') record.truncated = line.truncated;
  if (typeof line.summary === 'string') record.summary = line.summary;
  if (isStringMap(line.args_digest)) record.argsDigest = line.args_digest;
  return record;
}

function parseLine(line: string): ToolEventLine | undefined {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined; // 坏行
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
  if (typeof obj.duration_ms === 'number') out.duration_ms = obj.duration_ms;
  if (typeof obj.size === 'number') out.size = obj.size;
  if (typeof obj.inline_content === 'string') out.inline_content = obj.inline_content;
  if (typeof obj.artifact_size === 'number') out.artifact_size = obj.artifact_size;
  if (typeof obj.truncated === 'boolean') out.truncated = obj.truncated;
  if (typeof obj.summary === 'string') out.summary = obj.summary;
  if (isStringMap(obj.args_digest)) out.args_digest = obj.args_digest;
  return out;
}

function isStringMap(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string');
}
