/**
 * 文件系统可达性探测（零依赖）。
 *
 * 用于 `GET /api/admin/platform/health`（契约 §1.1）与部署前校验的
 * 「目标可写」项（`FR-027`）。集中一处，避免各处自行 `try/catch accessSync`
 * 造成口径漂移。
 */
import fs from 'node:fs';

export interface FsProbeResult {
  exists: boolean;
  readable: boolean;
  writable: boolean;
}

export function probePath(target: string): FsProbeResult {
  return {
    exists: fs.existsSync(target),
    readable: canAccess(target, fs.constants.R_OK),
    writable: canAccess(target, fs.constants.W_OK),
  };
}

/** `accessSync` 的布尔化封装（避免"先赋值再在两个分支里各自赋值"的冗余写法） */
function canAccess(target: string, mode: number): boolean {
  try {
    fs.accessSync(target, mode);
    return true;
  } catch {
    return false;
  }
}

