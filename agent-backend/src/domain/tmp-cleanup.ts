/**
 * tmp/ 定期清理（T040 / FR-028）：删除超过 30 天未访问的临时产出。
 *
 * "未访问"判定取 max(atime, mtime)——FileAccess 读 tmp 文件时会 utimes
 * 刷新访问时间，所以正在被引用的产出不会被误删。
 * 单个文件删除失败不中断整轮扫描。
 *
 * **009 归属**：临时空间是**数字人级**的，因此定时任务 MUST **按（用户 × 数字人）逐一**清理
 * （`cleanupAllAgentTmpDirs`）——只清某一个目录或漏清都会让"30 天清理"这条契约对部分数字人失效。
 * 某数字人的临时空间不存在（从未使用过）⇒ 直接跳过，不视作异常。
 */
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
    return result; // 目录不存在视为无可清理
  }
  for (const name of names) {
    if (name.startsWith('.upload-')) {
      // 上传暂存残留：超过 1 小时即清理（与 30 天规则无关）
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

/**
 * 按（用户 × 数字人）逐一清理各自的临时空间（009）。
 *
 * - 数字人清单由调用方给出（`listAgents` 口径：只含配置可用者）；已移除数字人的残留数据
 *   **不清理**（数据保留，只是不可见——FR-031），故不扫 `user-data/` 下的目录名。
 * - 数据目录不存在 ⇒ 该数字人从未写过临时空间，`cleanupTmpDir` 直接返回 0；
 * - 任一数字人清理失败不中断其余数字人（逐个独立计账）。
 */
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

/**
 * 清理某个**子目录**内的过期文件（R11 后台产出）。
 *
 * 判据与顶层一致（`max(atime, mtime)` 超 30 天，且以"真正读正文"为访问 —— 清单扫描
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
      logger?.info?.(`tmp 清理：已删除 30 天未访问的 ${label}/${name}`);
    } catch (err) {
      result.failed += 1;
      logger?.warn(
        `tmp 清理：删除 ${label}/${name} 失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
