/**
 * 「共享空间」存量目录的一次性清理（2026-11-18，`specs/025-remove-shared-space`）。
 *
 * **为什么需要它**：共享空间于 2026-11-18 下线，运行端从此不再承认这个一级目录
 * （不在 `SPACES` 白名单内 ⇒ HTTP 接口与模型工具一律 403）。但磁盘上既有的
 * `user-data/{数字人}/共享空间/` 不会自己消失——文件还在、却再也读不到，属于
 * "占空间又不可达"的残留。本模块负责把它们找出来并删掉。
 *
 * **只做一次性运维，不进任何请求/启动路径**：删除不可逆，故唯一入口是
 * `scripts/remove-shared-space.ts`（默认 dry-run，`--apply` 才动手）；服务进程
 * MUST NOT 引用本模块——否则每次重启都在做不可逆操作。
 *
 * **扫描面（两个布局都要覆盖）**：
 * - 数字人级（009 之后）：`users/{uid}/user-data/{数字人}/共享空间`
 * - 用户级（009 之前的旧布局）：`users/{uid}/user-data/共享空间`
 * 刻意**不做任意深度遍历**：只认这两层，避免把 `threads/`、`临时空间/` 等
 * 大量子目录卷进扫描（那里本来就不可能出现该名字）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { removeDirRecursiveAsync } from './fs-safe.js';

/**
 * 已下线的空间目录名。
 *
 * 这是**全仓唯一**允许在运行期代码里出现该名字的地方：清理脚本必须知道要删什么。
 * 业务代码 MUST NOT 引用它（空间名以 `dirs.ts` 的 `SPACES` 为唯一来源）。
 */
export const RETIRED_SHARED_SPACE_DIR = '共享空间';

export interface SharedSpaceDirInfo {
  /** 绝对路径 */
  absPath: string;
  /** 相对运行期根的可读路径（posix 分隔符） */
  relPath: string;
  /** 目录内文件总数（递归） */
  fileCount: number;
  /** 目录内文件总字节数（递归） */
  totalBytes: number;
}

export interface RemoveResult {
  /** 成功删除的目录（相对路径） */
  removed: string[];
  /** 删除失败的目录与原因 */
  failed: { relPath: string; reason: string }[];
}

/** 递归统计文件数与字节数；读不到的条目直接跳过（统计只用于预览，不是判据） */
function countFiles(dir: string): { fileCount: number; totalBytes: number } {
  let fileCount = 0;
  let totalBytes = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { fileCount, totalBytes };
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countFiles(abs);
      fileCount += nested.fileCount;
      totalBytes += nested.totalBytes;
      continue;
    }
    fileCount += 1;
    try {
      totalBytes += fs.statSync(abs).size;
    } catch {
      // 统计失败不影响删除
    }
  }
  return { fileCount, totalBytes };
}

function infoOf(optAgentRoot: string, absPath: string): SharedSpaceDirInfo {
  const absRoot = path.resolve(optAgentRoot);
  return {
    absPath,
    relPath: path.relative(absRoot, absPath).split(path.sep).join('/'),
    ...countFiles(absPath),
  };
}

/**
 * 列出运行期根下全部「共享空间」目录（只读，不改磁盘）。
 *
 * 根不存在 / `users/` 不存在 ⇒ 返回空数组（等价"没有该布局"）。
 */
export function findSharedSpaceDirs(optAgentRoot: string): SharedSpaceDirInfo[] {
  const usersRoot = path.join(path.resolve(optAgentRoot), 'users');
  let userIds: string[];
  try {
    userIds = fs
      .readdirSync(usersRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }

  const found: SharedSpaceDirInfo[] = [];
  for (const userId of userIds) {
    const userData = path.join(usersRoot, userId, 'user-data');
    // 旧布局（用户级）：user-data/共享空间
    const legacy = path.join(userData, RETIRED_SHARED_SPACE_DIR);
    if (isDirectory(legacy)) found.push(infoOf(optAgentRoot, legacy));

    // 数字人级（009 之后）：user-data/{数字人}/共享空间
    let agents: string[];
    try {
      agents = fs
        .readdirSync(userData, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      continue;
    }
    for (const agentName of agents) {
      const candidate = path.join(userData, agentName, RETIRED_SHARED_SPACE_DIR);
      if (isDirectory(candidate)) found.push(infoOf(optAgentRoot, candidate));
    }
  }
  return found;
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 删除给定的目录（**不可逆**，调用方必须先做 dry-run 确认）。
 *
 * 逐个独立计账：一个失败不中断其余；删除走 `fs-safe` 的 `removeDirRecursiveAsync`
 * （Windows 非 ASCII 路径下 `fs.rm` 会静默失效，见该模块头注释）。
 */
export async function removeSharedSpaceDirs(dirs: readonly SharedSpaceDirInfo[]): Promise<RemoveResult> {
  const result: RemoveResult = { removed: [], failed: [] };
  for (const dir of dirs) {
    try {
      await removeDirRecursiveAsync(dir.absPath);
      result.removed.push(dir.relPath);
    } catch (err) {
      result.failed.push({
        relPath: dir.relPath,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}
