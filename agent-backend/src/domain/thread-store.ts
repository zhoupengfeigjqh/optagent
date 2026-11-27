import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { HistoryMessage } from '../types.js';
import { InvalidThreadIdError, SPACE_TMP, THREADS_DIR, threadDir, userDataDir } from './dirs.js';
import { removeDirRecursiveAsync, removeFileSafeAsync } from './fs-safe.js';
import type { HistoryStore } from './history.js';

const TITLE_LEN = 20;

function isValidSource(
  source: MetaFile['source'] | undefined,
): source is NonNullable<MetaFile['source']> {
  return (
    typeof source === 'object' &&
    source !== null &&
    source.type === 'scheduled_task' &&
    typeof source.task_id === 'string' &&
    typeof source.task_name === 'string' &&
    typeof source.triggered_at === 'string'
  );
}

export function defaultTitleOf(messages: HistoryMessage[]): string | null {
  const first = messages.find((m) => m.role === 'user');
  return first ? [...first.content].slice(0, TITLE_LEN).join('') : null;
}

/**
 * 会话来源标记（015）：目前只有"定时任务"一种，字段保留为可扩展枚举。
 *
 * 缺省不写、不写 `null`：普通会话的 meta 里 MUST NOT 出现该键，
 * 旧前端与旧数据因此完全不受影响（见 `contracts/thread-source.md`）。
 */
export interface ThreadSource {
  type: 'scheduled_task';
  taskId: string;
  taskName: string;
  triggeredAt: string;
}

export interface ThreadMeta {
  threadId: string;
  agentName: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  source?: ThreadSource;
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
  source?: {
    type: 'scheduled_task';
    task_id: string;
    task_name: string;
    triggered_at: string;
  };
}

export class ThreadStore {
  private readonly titleCache = new Map<string, string>();

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

  create(
    userId: string,
    agentName: string,
    opts: { title?: string | null; source?: ThreadSource } = {},
  ): ThreadMeta {
    const now = new Date().toISOString();
    const meta: ThreadMeta = {
      threadId: randomUUID(),
      agentName,
      title: opts.title ?? null,
      createdAt: now,
      updatedAt: now,
      ...(opts.source ? { source: opts.source } : {}),
    };
    const dir = threadDir(this.root, userId, agentName, meta.threadId);
    fs.mkdirSync(dir, { recursive: true });
    this.writeMeta(userId, agentName, meta);
    return meta;
  }

  get(userId: string, agentName: string, threadId: string): ThreadMeta {
    let raw: string;
    try {
      raw = fs.readFileSync(this.metaPath(userId, agentName, threadId), 'utf8');
    } catch (err) {
      // 2026-11-26：非法标识要如实报 400，不能混进"不存在"的 404——
      // 否则排查路径穿越/客户端拼错 id 时，日志与状态码都指向错误方向。
      // 安全性不变：`threadDir` 先断言，非法 id 一次文件访问都不会发生。
      if (err instanceof InvalidThreadIdError) throw err;
      throw new ThreadNotFoundError(threadId);
    }
    let m: MetaFile;
    try {
      m = JSON.parse(raw) as MetaFile;
    } catch {
      throw new ThreadNotFoundError(threadId);
    }
    return {
      threadId: m.thread_id,
      agentName,
      title: m.title ?? null,
      createdAt: m.created_at,
      updatedAt: m.updated_at,
      ...(isValidSource(m.source)
        ? {
            source: {
              type: 'scheduled_task',
              taskId: m.source.task_id,
              taskName: m.source.task_name,
              triggeredAt: m.source.triggered_at,
            },
          }
        : {}),
    };
  }

  /**
   * 会话是否存在（015）：运行记录的"会话已删除"判定。
   *
   * 放在 domain 层而不是路由里：接口层 MUST NOT 直接访问文件系统（宪章原则二）；
   * 且"存在"的判据（meta.json 可解析）与 `get` 必须同源，不能各写一套。
   */
  exists(userId: string, agentName: string, threadId: string): boolean {
    try {
      this.get(userId, agentName, threadId);
      return true;
    } catch {
      return false;
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
        // 缺 meta.json 的目录不计入
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
      // touch 失败不阻断对话主流程
    }
  }

  list(userId: string, agentName: string): ThreadMeta[] {
    const dir = this.threadsRoot(userId, agentName);
    if (!fs.existsSync(dir)) return [];
    const metas: ThreadMeta[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const m = this.get(userId, agentName, entry.name);
        if (m.createdAt === m.updatedAt) continue;
        metas.push(m);
      } catch {
        // 损坏的会话目录跳过
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
    return (
      this.get(userId, agentName, threadId).title ?? this.defaultTitle(userId, agentName, threadId)
    );
  }

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

  rename(userId: string, agentName: string, threadId: string, title: string): ThreadMeta {
    const meta = this.get(userId, agentName, threadId);
    meta.title = title;
    meta.updatedAt = new Date().toISOString();
    this.writeMeta(userId, agentName, meta);
    return meta;
  }

  async delete(userId: string, agentName: string, threadId: string): Promise<void> {
    this.get(userId, agentName, threadId);
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
      // 有值才写：普通会话的 meta MUST NOT 出现 `source` 键（契约 thread-source.md §1）
      ...(meta.source
        ? {
            source: {
              type: meta.source.type,
              task_id: meta.source.taskId,
              task_name: meta.source.taskName,
              triggered_at: meta.source.triggeredAt,
            },
          }
        : {}),
    };
    fs.writeFileSync(
      this.metaPath(userId, agentName, meta.threadId),
      JSON.stringify(file, null, 2),
      'utf8',
    );
  }
}
