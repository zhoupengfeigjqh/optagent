/**
 * thread 元数据存储（FR-008/010）：meta.json 读写、创建（UUID）、
 * 列表（updated_at 倒序，title 默认取首条 user 消息前 20 字）、重命名、
 * 删除连带清理（thread 目录 + tmp 下 thread_id 前缀文件）、updated_at 维护。
 *
 * 存储：threads/{thread_id}/meta.json
 * { "thread_id", "agent_name", "title", "created_at", "updated_at" }
 *
 * 说明（FR-014 修订）：会话**不绑定**数字人，`agent_name` 表示该会话
 * **最近一轮使用的数字人**（创建时为首个数字人，每轮结束由 `touch` 更新）。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryMessage } from '../types.js';
import { SPACE_TMP, THREADS_DIR, threadDir, userDataDir } from './dirs.js';
import { removeDirRecursive, removeFileSafe } from './fs-safe.js';
import type { HistoryStore } from './history.js';

/** 默认标题截取长度（首条 user 消息前 20 字） */
const TITLE_LEN = 20;

/** 默认标题：首条 user 消息前 20 字（按 Unicode 码点计）；无 user 消息 → null */
export function defaultTitleOf(messages: HistoryMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user');
  return first ? [...first.content].slice(0, TITLE_LEN).join('') : null;
}

export interface ThreadMeta {
  threadId: string;
  /** 最近一轮使用的数字人（会话可跨数字人；创建时为首个数字人） */
  agentName: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ThreadNotFoundError extends Error {
  readonly code = 'THREAD_NOT_FOUND';
  constructor(threadId: string) {
    super(`对话不存在：${threadId}`);
    this.name = 'ThreadNotFoundError';
  }
}

interface MetaFile {
  thread_id: string;
  agent_name: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export class ThreadStore {
  /**
   * 默认标题缓存（key = `${userId}/${threadId}`）。
   *
   * 首条 user 消息一旦写入就再也不会变化（history 只追加），因此非空结果可长期缓存；
   * 缓存后 `list` / `resolveTitle` 不必为每个无标题会话重读整份 history.jsonl。
   * 空结果（尚无 user 消息）不缓存——空会话后续可能补上首条消息。
   */
  private readonly titleCache = new Map<string, string>();

  /**
   * @param history 可选：注入后 list 可将空 title 回落为
   *   首条 user 消息前 20 字（FR-010）
   */
  constructor(
    private readonly root: string,
    private readonly history?: HistoryStore,
  ) {}

  private metaPath(userId: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, threadId), 'meta.json');
  }

  private threadsRoot(userId: string): string {
    return path.join(userDataDir(this.root, userId), THREADS_DIR);
  }

  create(userId: string, agentName: string): ThreadMeta {
    const now = new Date().toISOString();
    const meta: ThreadMeta = {
      threadId: randomUUID(),
      agentName,
      title: null,
      createdAt: now,
      updatedAt: now,
    };
    const dir = threadDir(this.root, userId, meta.threadId);
    fs.mkdirSync(dir, { recursive: true });
    this.writeMeta(userId, meta);
    return meta;
  }

  get(userId: string, threadId: string): ThreadMeta {
    let raw: string;
    try {
      raw = fs.readFileSync(this.metaPath(userId, threadId), 'utf8');
    } catch {
      throw new ThreadNotFoundError(threadId);
    }
    try {
      const m = JSON.parse(raw) as MetaFile;
      return {
        threadId: m.thread_id,
        agentName: m.agent_name,
        title: m.title ?? null,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      };
    } catch {
      throw new ThreadNotFoundError(threadId);
    }
  }

  /** 该数字人已有的 thread 数（统计用；会话总数不再作为创建上限） */
  countByAgent(userId: string, agentName: string): number {
    const dir = this.threadsRoot(userId);
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(dir, entry.name, 'meta.json'), 'utf8')) as MetaFile;
        if (m.agent_name === agentName) count++;
      } catch {
        /* 损坏的 meta 不计入 */
      }
    }
    return count;
  }

  /**
   * 每轮对话结束更新 updated_at；传入 agentName 时同步把该会话的
   * `agent_name` 更新为**最近一轮使用的数字人**（会话可跨数字人）。
   */
  touch(userId: string, threadId: string, agentName?: string): void {
    try {
      const meta = this.get(userId, threadId);
      meta.updatedAt = new Date().toISOString();
      if (agentName) meta.agentName = agentName;
      this.writeMeta(userId, meta);
    } catch {
      /* thread 已被删除等场景：忽略 */
    }
  }

  /** 列表：updated_at 倒序；可按数字人过滤；空 title 回落默认标题 */
  list(userId: string, agentName?: string): ThreadMeta[] {
    const dir = this.threadsRoot(userId);
    if (!fs.existsSync(dir)) return [];
    const metas: ThreadMeta[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const m = this.get(userId, entry.name);
        if (agentName && m.agentName !== agentName) continue;
        metas.push(m);
      } catch {
        /* 损坏的 meta 不列出 */
      }
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const m of metas) {
      m.title ??= this.defaultTitle(userId, m.threadId);
    }
    return metas;
  }

  /** 展示用标题：已命名返回原名，否则回落默认标题 */
  resolveTitle(userId: string, threadId: string): string | null {
    return this.get(userId, threadId).title ?? this.defaultTitle(userId, threadId);
  }

  /** 默认标题：首条 user 消息前 20 字（按 Unicode 码点计）；命中缓存则不读盘 */
  private defaultTitle(userId: string, threadId: string): string | null {
    if (!this.history) return null;
    const key = this.cacheKey(userId, threadId);
    const cached = this.titleCache.get(key);
    if (cached !== undefined) return cached;
    const title = defaultTitleOf(this.history.readAll(userId, threadId));
    if (title !== null) this.titleCache.set(key, title);
    return title;
  }

  private cacheKey(userId: string, threadId: string): string {
    return `${userId}/${threadId}`;
  }

  /** 重命名（≤100 字由路由层校验） */
  rename(userId: string, threadId: string, title: string): ThreadMeta {
    const meta = this.get(userId, threadId); // 不存在抛 ThreadNotFoundError
    meta.title = title;
    meta.updatedAt = new Date().toISOString();
    this.writeMeta(userId, meta);
    return meta;
  }

  /** 删除连带清理（FR-010）：thread 目录 + tmp 下 `{thread_id}_` 前缀文件 */
  delete(userId: string, threadId: string): void {
    this.get(userId, threadId); // 不存在抛 ThreadNotFoundError
    this.titleCache.delete(this.cacheKey(userId, threadId));
    removeDirRecursive(threadDir(this.root, userId, threadId));
    const tmpDir = path.join(userDataDir(this.root, userId), SPACE_TMP);
    if (!fs.existsSync(tmpDir)) return;
    for (const entry of fs.readdirSync(tmpDir)) {
      // tmp 产出均为文件；统一走安全删除原语（见 fs-safe）
      if (entry.startsWith(`${threadId}_`)) {
        removeFileSafe(path.join(tmpDir, entry));
      }
    }
  }

  private writeMeta(userId: string, meta: ThreadMeta): void {
    const file: MetaFile = {
      thread_id: meta.threadId,
      agent_name: meta.agentName,
      title: meta.title,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
    };
    fs.writeFileSync(this.metaPath(userId, meta.threadId), JSON.stringify(file, null, 2), 'utf8');
  }
}
