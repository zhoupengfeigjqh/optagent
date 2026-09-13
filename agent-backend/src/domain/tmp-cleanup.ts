/**
 * tmp/ 定期清理（T040 / FR-028）：删除超过 7 天未访问的临时产出。
 *
 * "未访问"判定取 max(atime, mtime)——FileAccess 读 tmp 文件时会 utimes
 * 刷新访问时间，所以正在被引用的产出不会被误删。
 * 单个文件删除失败不中断整轮扫描。
 */
import fs from 'node:fs';
import path from 'node:path';
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
    if (!stat || !stat.isFile()) continue;
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
