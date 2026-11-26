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
  absPath: string;
  relPath: string;
  fileCount: number;
  totalBytes: number;
}

export interface RemoveResult {
  removed: string[];
  failed: { relPath: string; reason: string }[];
}

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
      // stat 失败（如并发删除）按 0 字节计
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
    const legacy = path.join(userData, RETIRED_SHARED_SPACE_DIR);
    if (isDirectory(legacy)) found.push(infoOf(optAgentRoot, legacy));

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
