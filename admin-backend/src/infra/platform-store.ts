/**
 * 平台设计态存储（`research.md` D4）。
 *
 * - 全部以 **JSON 文档**组织在 `.platform-data/` 下（`data-model.md` §1）；
 * - 写入一律"**写临时文件 → fsync → 原子 rename**"，满足原则五对
 *   "状态变更 MUST 使用事务或等价的原子替换"的要求；
 * - 并发控制：`meta.json` 的**单调递增 `revision`** 作为乐观锁，
 *   不符即 `ADM_CONFIG_REVISION_CONFLICT`（`FR-008`）。
 *
 * 临时文件与目标文件**同目录**——保证 `rename` 不跨设备（`research.md` D8 同一约束）。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export interface MetaDocument {
  revision: number;
  schema_version: string;
  created_at: string;
  updated_at: string;
}

/** 设计态文档的格式版本，供未来迁移 */
export const SCHEMA_VERSION = '1.0.0';

const META_REL = 'meta.json';

export interface PlatformStoreOptions {
  logger?: Logger;
}

export class PlatformStore {
  private readonly root: string;
  private readonly logger: Logger | undefined;

  constructor(root: string, options: PlatformStoreOptions = {}) {
    this.root = root;
    this.logger = options.logger;
  }

  getRoot(): string {
    return this.root;
  }

  /** 相对路径 → 绝对路径（**拒绝越界**：`..` 与绝对路径一律拒） */
  abs(rel: string): string {
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `非法的设计态相对路径：${rel}`);
    }
    return path.join(this.root, ...normalized.split('/').filter(Boolean));
  }

  /** 建立目录骨架并确保 `meta.json` 存在（幂等） */
  ensureLayout(): void {
    this.failIfNotWritable();
    for (const dir of ['', 'skills', 'agents', 'users', 'deploy', 'logs']) {
      fs.mkdirSync(path.join(this.root, dir), { recursive: true });
    }
    if (!fs.existsSync(this.abs(META_REL))) {
      const now = new Date().toISOString();
      this.writeJson(META_REL, {
        revision: 1,
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now,
      } satisfies MetaDocument);
    }
  }

  /** 平台设计态不可写 → `ADM_STORAGE_UNAVAILABLE`（health 端点据此外报） */
  failIfNotWritable(): void {
    try {
      fs.mkdirSync(this.root, { recursive: true });
      fs.accessSync(this.root, fs.constants.W_OK);
    } catch {
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `平台设计态目录不可写：${this.root}`,
      );
    }
  }

  isWritable(): boolean {
    try {
      this.failIfNotWritable();
      return true;
    } catch {
      return false;
    }
  }

  exists(rel: string): boolean {
    return fs.existsSync(this.abs(rel));
  }

  /** 读取 JSON 文档；文件不存在返回 `null`（**不**视为错误） */
  readJson<T>(rel: string): T | null {
    const text = this.readText(rel);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `平台设计态文档损坏（不是合法 JSON）：${rel}`,
      );
    }
  }

  readText(rel: string): string | null {
    const abs = this.abs(rel);
    try {
      return fs.readFileSync(abs, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `读取平台设计态失败：${rel}（${(err as Error).message}）`,
      );
    }
  }

  /** 原子写入 JSON 文档 */
  writeJson(rel: string, data: unknown): void {
    this.writeText(rel, `${JSON.stringify(data, null, 2)}\n`);
  }

  /**
   * 原子写入文本：临时文件 → `fsync` → `rename`。
   * 中途失败不会留下半截文件（读者看到的要么是旧内容，要么是新内容）。
   */
  writeText(rel: string, text: string): void {
    const abs = this.abs(rel);
    const dir = path.dirname(abs);
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `创建平台设计态目录失败：${path.relative(this.root, dir)}（${(err as Error).message}）`,
      );
    }

    const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(tmp, abs);
    } catch (err) {
      if (fd !== undefined) {
        try {
          fs.closeSync(fd);
        } catch {
          /* 关闭失败不影响主流程的报错 */
        }
      }
      try {
        fs.rmSync(tmp, { force: true });
      } catch {
        /* 清理临时文件失败不影响报错语义 */
      }
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `写入平台设计态失败：${rel}（${(err as Error).message}）`,
      );
    }
  }

  /** 删除文件或目录（幂等） */
  remove(rel: string): void {
    fs.rmSync(this.abs(rel), { recursive: true, force: true });
  }

  /** 目录项（相对路径名）；目录不存在返回空数组 */
  listDir(rel: string): string[] {
    try {
      return fs.readdirSync(this.abs(rel));
    } catch {
      return [];
    }
  }

  /** 追加一行 JSON（`deploy/history.jsonl`） */
  appendJsonl(rel: string, data: unknown): void {
    const abs = this.abs(rel);
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.appendFileSync(abs, `${JSON.stringify(data)}\n`, 'utf8');
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `追加记录失败：${rel}（${(err as Error).message}）`,
      );
    }
  }

  /** 读取 JSONL（损坏行跳过并告警，不影响其余记录） */
  readJsonl<T>(rel: string): T[] {
    const text = this.readText(rel);
    if (text === null) return [];
    const out: T[] = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as T);
      } catch {
        this.logger?.warn({ event: 'store.jsonl.corrupt', file: rel }, '跳过损坏的历史记录行');
      }
    }
    return out;
  }

  /* ---------- revision（乐观并发控制） ---------- */

  meta(): MetaDocument {
    const meta = this.readJson<MetaDocument>(META_REL);
    if (meta && typeof meta.revision === 'number') return meta;
    // 目录尚未初始化（或 meta 被外部删除）：按初始态处理，不抛错
    const now = new Date().toISOString();
    return { revision: 1, schema_version: SCHEMA_VERSION, created_at: now, updated_at: now };
  }

  revision(): number {
    return this.meta().revision;
  }

  /** 校验客户端持有的版本；不符即 409 冲突（`FR-008`） */
  assertRevision(expected: number): void {
    const actual = this.revision();
    if (expected !== actual) {
      throw new ApiError(
        ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
        `配置已被他处修改（期望版本 ${expected}，当前版本 ${actual}），请刷新后重试`,
      );
    }
  }

  /**
   * 在版本保护下执行一次设计态变更：校验版本 → 执行 → 递增版本。
   * `fn` 抛错时不递增版本（保证"失败不留痕"）。
   */
  withRevision<T>(expected: number, fn: () => T): { result: T; revision: number } {
    this.assertRevision(expected);
    const result = fn();
    return { result, revision: this.bumpRevision() };
  }

  /** 原子递增 `revision` 并返回新值 */
  bumpRevision(): number {
    const meta = this.meta();
    const now = new Date().toISOString();
    const next: MetaDocument = {
      revision: meta.revision + 1,
      schema_version: meta.schema_version || SCHEMA_VERSION,
      created_at: meta.created_at || now,
      updated_at: now,
    };
    this.writeJson(META_REL, next);
    return next.revision;
  }
}
