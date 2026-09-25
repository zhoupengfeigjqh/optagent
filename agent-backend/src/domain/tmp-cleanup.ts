/**
 * tmp/ 定期清理（T040 / FR-028）：删除超过 7 天未访问的临时产出。
 *
 * "未访问"判定取 max(atime, mtime)——FileAccess 读 tmp 文件时会 utimes
 * 刷新访问时间，所以正在被引用的产出不会被误删。
 * 单个文件删除失败不中断整轮扫描。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PRODUCED_SUBDIR } from './dirs.js';
import { removeFileSafeAsync } from './fs-safe.js';

export const TMP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupLogger {
  warn(msg: string): void;
  info?(msg: string): void;
}

export interface CleanupResult {
  deleted: number;
  failed: number;
}

export async function cleanupTmpDir(
  tmpDir: string,
  opts: { maxAgeMs?: number; now?: Date; logger?: CleanupLogger } = {},
): Promise<CleanupResult> {
  const maxAgeMs = opts.maxAgeMs ?? TMP_MAX_AGE_MS;
  const now = (opts.now ?? new Date()).getTime();
  const result: CleanupResult = { deleted: 0, failed: 0 };

  let names: string[];
  try {
    names = await fs.promises.readdir(tmpDir);
  } catch {
    return result; // 目录不存在视为无可清理
  }
  for (const name of names) {
    if (name.startsWith('.upload-')) {
      // 上传暂存残留：超过 1 小时即清理（与 7 天规则无关）
      const abs = path.join(tmpDir, name);
      const stat = await fs.promises.stat(abs).catch(() => null);
      if (stat && now - stat.mtimeMs > 60 * 60 * 1000) {
        // 删除走安全原语（Windows 非 ASCII 路径下 fs.rm 静默失效，见 fs-safe）
        await removeFileSafeAsync(abs).catch(() => {
          result.failed += 1;
        });
      }
      continue;
    }
    const abs = path.join(tmpDir, name);
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat) continue;
    if (stat.isDirectory()) {
      // 后台产出（R11）：二级目录也按同一 7 天口径清理——否则契约 §10.4 的
      // "随临时空间既有规则清理"不成立（原先此处直接跳过目录，产出实际永不清理）。
      // 只认**已登记**的子目录，不递归任意目录，避免误删将来可能出现的其他子目录。
      if (name === PRODUCED_SUBDIR) {
        await cleanupFilesIn(abs, now, maxAgeMs, result, opts.logger, name);
      }
      continue;
    }
    if (!stat.isFile()) continue;
    const lastTouched = Math.max(stat.atimeMs, stat.mtimeMs);
    if (now - lastTouched < maxAgeMs) continue;
    try {
      await removeFileSafeAsync(abs);
      result.deleted += 1;
      opts.logger?.info?.(`tmp 清理：已删除 7 天未访问文件 ${name}`);
    } catch (err) {
      result.failed += 1;
      opts.logger?.warn(
        `tmp 清理：删除 ${name} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}

/**
 * 清理某个**子目录**内的过期文件（R11 后台产出）。
 *
 * 判据与顶层一致（`max(atime, mtime)` 超 7 天，且以"真正读正文"为访问 —— 清单扫描
 * 走 `FileAccess.read(..., { touch: false })`，不给产出续命，见 `file-access`）。
 * 正文与 sidecar 是同生命周期文件、写入时刻相同，故会一起消失。
 */
async function cleanupFilesIn(
  dir: string,
  now: number,
  maxAgeMs: number,
  result: CleanupResult,
  logger?: CleanupLogger,
  label = '',
): Promise<void> {
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return; // 目录不可读视为无可清理
  }
  for (const name of names) {
    const abs = path.join(dir, name);
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    if (now - Math.max(stat.atimeMs, stat.mtimeMs) < maxAgeMs) continue;
    try {
      await removeFileSafeAsync(abs);
      result.deleted += 1;
      logger?.info?.(`tmp 清理：已删除 7 天未访问的 ${label}/${name}`);
    } catch (err) {
      result.failed += 1;
      logger?.warn(
        `tmp 清理：删除 ${label}/${name} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
