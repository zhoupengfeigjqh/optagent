import fs from 'node:fs';
import path from 'node:path';
import { PRODUCED_SUBDIR, SPACE_TMP, userDataDir } from './dirs.js';
import { removeFileSafeAsync } from './fs-safe.js';

export const TMP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
    return result;
  }
  for (const name of names) {
    if (name.startsWith('.upload-')) {
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
      // 后台产出（R11）：二级目录也按同一 30 天口径清理——否则契约 §10.4 的
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
      opts.logger?.info?.(`tmp 清理：已删除 30 天未访问文件 ${name}`);
    } catch (err) {
      result.failed += 1;
      opts.logger?.warn(
        `tmp 清理：删除 ${name} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return result;
}

export async function cleanupAllAgentTmpDirs(
  optAgentRoot: string,
  userIds: readonly string[],
  listAgentsOf: (userId: string) => readonly string[],
  opts: { maxAgeMs?: number; now?: Date; logger?: CleanupLogger } = {},
): Promise<CleanupResult & { dirs: number }> {
  const total: CleanupResult & { dirs: number } = { deleted: 0, failed: 0, dirs: 0 };
  for (const userId of userIds) {
    for (const agentName of listAgentsOf(userId)) {
      const tmpDir = path.join(userDataDir(optAgentRoot, userId, agentName), SPACE_TMP);
      const one = await cleanupTmpDir(tmpDir, opts);
      total.deleted += one.deleted;
      total.failed += one.failed;
      total.dirs += 1;
    }
  }
  if (total.deleted > 0 || total.failed > 0) {
    opts.logger?.info?.(
      `tmp 清理（按数字人遍历 ${total.dirs} 个临时空间）：删除 ${total.deleted} 个、失败 ${total.failed} 个`,
    );
  }
  return total;
}

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
      logger?.info?.(`tmp 清理：已删除 30 天未访问的 ${label}/${name}`);
    } catch (err) {
      result.failed += 1;
      logger?.warn(
        `tmp 清理：删除 ${label}/${name} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
