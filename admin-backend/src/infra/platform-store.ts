import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { removeTree } from './fs-remove.js';

export interface MetaDocument {
  revision: number;
  schema_version: string;
  created_at: string;
  updated_at: string;
}

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

  abs(rel: string): string {
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, `非法的设计态相对路径：${rel}`);
    }
    return path.join(this.root, ...normalized.split('/').filter(Boolean));
  }

  /**
   * 建立目录骨架并确保 `meta.json` 存在（幂等）。
   *
   * `onto_market/` 为**本体库**（2026-10-03，`FR-060`）：结构与市场前两级一致
   * （`{场景}/{本体}/ontology.yaml`），文件名沿用市场侧同名。
   */
  ensureLayout(): void {
    this.failIfNotWritable();
    for (const dir of ['', 'skills', 'agents', 'users', 'deploy', 'logs', 'onto_market']) {
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
      throw new ApiError(ERROR_CODES.ADM_STORAGE_UNAVAILABLE, `平台设计态目录不可写：${this.root}`);
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

  readJson<T>(rel: string): T | null {
    const text = this.readText(rel);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError(ERROR_CODES.ADM_STORAGE_UNAVAILABLE, `平台设计态文档损坏（不是合法 JSON）：${rel}`);
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
        // 临时文件名带目标 basename（可能是中文），故同样不能走 `fs.rmSync`（见 fs-remove.ts）
        removeTree(tmp);
      } catch {
        /* 清理临时文件失败不影响报错语义 */
      }
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `写入平台设计态失败：${rel}（${(err as Error).message}）`,
      );
    }
  }

  remove(rel: string): void {
    const abs = this.abs(rel);
    removeTree(abs);
    if (fs.existsSync(abs)) {
      throw new ApiError(
        ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
        `删除平台设计态失败：${rel}（目标仍存在，可能是被其它进程占用；请手工删除后重试）`,
      );
    }
  }

  listDir(rel: string): string[] {
    try {
      return fs.readdirSync(this.abs(rel));
    } catch {
      return [];
    }
  }

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
    const now = new Date().toISOString();
    return { revision: 1, schema_version: SCHEMA_VERSION, created_at: now, updated_at: now };
  }

  revision(): number {
    return this.meta().revision;
  }

  assertRevision(expected: number): void {
    const actual = this.revision();
    if (expected !== actual) {
      throw new ApiError(
        ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
        `配置已被他处修改（期望版本 ${expected}，当前版本 ${actual}），请刷新后重试`,
      );
    }
  }

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
