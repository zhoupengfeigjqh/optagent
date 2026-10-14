/**
 * thread 元数据存储（FR-008/010）：meta.json 读写、创建（UUID）、
 * 列表（updated_at 倒序，title 默认取首条 user 消息前 20 字）、重命名、
 * 删除连带清理（thread 目录 + tmp 下 thread_id 前缀文件）、updated_at 维护。
 *
 * 存储（009 归属）：`user-data/{数字人}/threads/{thread_id}/meta.json`
 * { "thread_id", "agent_name", "title", "created_at", "updated_at" }
 *
 * **归属语义（FR-020/022，D3）**：会话的数字人归属**由目录位置承载**——数字人是
 * 每个方法的必填入参，跨数字人访问在路径层就解析不到（天然 `404`，不泄露存在性）。
 * `meta.agent_name` 因此从"最近一轮使用的数字人"反转为**归属键**：
 * 创建时写定，`touch()` **MUST NOT** 覆写；返回时一律以**目录作用域**为准
 * （历史数据里可能残留旧语义的值，不构成第二份真相）。
 *
 * **列表判据（FR-016）**：只呈现**有消息**的会话——判据＝"尚无任何轮次"
 * （`created_at` 与 `updated_at` 相等），**零额外 IO**（不逐会话读 history.jsonl）。
 * 空对话＝视图态（不落盘），「新建对话」不产生记录，故该判据即"列表只见真实会话"。
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryMessage } from '../types.js';
import { SPACE_TMP, THREADS_DIR, threadDir, userDataDir } from './dirs.js';
import { removeDirRecursiveAsync, removeFileSafeAsync } from './fs-safe.js';
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
  /** 归属数字人（只读；＝所在数据目录名，见文件头注释） */
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
   * 默认标题缓存（key = `${userId}/${agentName}/${threadId}`）。
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

  private metaPath(userId: string, agentName: string, threadId: string): string {
    return path.join(threadDir(this.root, userId, agentName, threadId), 'meta.json');
  }

  private threadsRoot(userId: string, agentName: string): string {
    return path.join(userDataDir(this.root, userId, agentName), THREADS_DIR);
  }

  /** 创建会话：归属＝调用方给出的**当前作用域**（服务端判定，见 `agent-scope.ts`） */
  create(userId: string, agentName: string): ThreadMeta {
    const now = new Date().toISOString();
    const meta: ThreadMeta = {
      threadId: randomUUID(),
      agentName,
      title: null,
      createdAt: now,
      updatedAt: now,
    };
    const dir = threadDir(this.root, userId, agentName, meta.threadId);
    fs.mkdirSync(dir, { recursive: true });
    this.writeMeta(userId, agentName, meta);
    return meta;
  }

  /** 读取会话元数据；不存在/损坏 → ThreadNotFoundError（跨数字人同样落在这里） */
  get(userId: string, agentName: string, threadId: string): ThreadMeta {
    let raw: string;
    try {
      raw = fs.readFileSync(this.metaPath(userId, agentName, threadId), 'utf8');
    } catch {
      throw new ThreadNotFoundError(threadId);
    }
    try {
      const m = JSON.parse(raw) as MetaFile;
      return {
        threadId: m.thread_id,
        // 归属以**目录作用域**为准（meta 里的历史值不作为第二份真相）
        agentName,
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
    const dir = this.threadsRoot(userId, agentName);
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        fs.readFileSync(path.join(dir, entry.name, 'meta.json'), 'utf8');
        count++;
      } catch {
        /* 损坏的 meta 不计入 */
      }
    }
    return count;
  }

  /**
   * 每轮对话结束更新 `updated_at`。
   *
   * **MUST NOT 覆写归属**（FR-022，D3）：会话归属在创建时写定，生命周期内不可变更；
   * 旧实现这里的"同步最近一轮数字人"语义已废止（那是"会话可跨数字人"的载荷）。
   */
  touch(userId: string, agentName: string, threadId: string): void {
    try {
      const meta = this.get(userId, agentName, threadId);
      meta.updatedAt = new Date().toISOString();
      this.writeMeta(userId, agentName, meta);
    } catch {
      /* thread 已被删除等场景：忽略 */
    }
  }

  /**
   * 列表：**本数字人**的会话，`updated_at` 倒序；空 title 回落默认标题。
   *
   * 只返回**有消息**的会话（FR-016）：`created_at` 与 `updated_at` 相等 ⇒ 尚无任何轮次
   * （一轮必经模型调用，必然刷新 `updated_at`）。判据取自 meta.json，零额外 IO。
   * 磁盘上因异常路径遗留的空会话**不删**（用户可显式删除），只是不列出。
   */
  list(userId: string, agentName: string): ThreadMeta[] {
    const dir = this.threadsRoot(userId, agentName);
    if (!fs.existsSync(dir)) return [];
    const metas: ThreadMeta[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const m = this.get(userId, agentName, entry.name);
        if (m.createdAt === m.updatedAt) continue; // 空对话（视图态遗留）：不入列表
        metas.push(m);
      } catch {
        /* 损坏的 meta 不列出 */
      }
    }
    metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    for (const m of metas) {
      m.title ??= this.defaultTitle(userId, agentName, m.threadId);
    }
    return metas;
  }

  /** 展示用标题：已命名返回原名，否则回落默认标题 */
  resolveTitle(userId: string, agentName: string, threadId: string): string | null {
    return this.get(userId, agentName, threadId).title ?? this.defaultTitle(userId, agentName, threadId);
  }

  /** 默认标题：首条 user 消息前 20 字（按 Unicode 码点计）；命中缓存则不读盘 */
  private defaultTitle(userId: string, agentName: string, threadId: string): string | null {
    if (!this.history) return null;
    const key = this.cacheKey(userId, agentName, threadId);
    const cached = this.titleCache.get(key);
    if (cached !== undefined) return cached;
    const title = defaultTitleOf(this.history.readAll(userId, agentName, threadId));
    if (title !== null) this.titleCache.set(key, title);
    return title;
  }

  private cacheKey(userId: string, agentName: string, threadId: string): string {
    return `${userId}/${agentName}/${threadId}`;
  }

  /** 重命名（≤100 字由路由层校验） */
  rename(userId: string, agentName: string, threadId: string, title: string): ThreadMeta {
    const meta = this.get(userId, agentName, threadId); // 不存在抛 ThreadNotFoundError
    meta.title = title;
    meta.updatedAt = new Date().toISOString();
    this.writeMeta(userId, agentName, meta);
    return meta;
  }

  /**
   * 删除连带清理（FR-010）：thread 目录 + **本数字人**临时空间下 `{thread_id}_` 前缀文件。
   *
   * **async**：删除是「多文件 × 单次文件系统调用」，而单次删除的开销在软件层可能差两个数量级
   * （见 `fs-safe` 头部的实测：同机 C: 0–1ms vs D: ~300ms）。同步实现会把整段删除占住
   * 事件循环，令用户**紧接着**发出的"切换会话"请求一起排队——表现为"删完再点别的会话要转几秒"。
   */
  async delete(userId: string, agentName: string, threadId: string): Promise<void> {
    this.get(userId, agentName, threadId); // 不存在抛 ThreadNotFoundError
    this.titleCache.delete(this.cacheKey(userId, agentName, threadId));
    await removeDirRecursiveAsync(threadDir(this.root, userId, agentName, threadId));

    const tmpDir = path.join(userDataDir(this.root, userId, agentName), SPACE_TMP);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(tmpDir);
    } catch {
      return; // 临时空间不存在 = 无可清理
    }
    for (const entry of entries) {
      // tmp 产出均为文件；统一走安全删除原语（见 fs-safe）
      if (entry.startsWith(`${threadId}_`)) {
        await removeFileSafeAsync(path.join(tmpDir, entry));
      }
    }
  }

  private writeMeta(userId: string, agentName: string, meta: ThreadMeta): void {
    const file: MetaFile = {
      thread_id: meta.threadId,
      agent_name: meta.agentName,
      title: meta.title,
      created_at: meta.createdAt,
      updated_at: meta.updatedAt,
    };
    fs.writeFileSync(this.metaPath(userId, agentName, meta.threadId), JSON.stringify(file, null, 2), 'utf8');
  }
}
