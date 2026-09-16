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

/**
 * 注：部署目标 `users/{uid}/agents/` 在首次部署前通常**不存在**，
 * 因此"目标可写"要向上找最近的已存在祖先来判断——该逻辑收在
 * `domain/deploy/deployer.ts` 的 `isUserTargetWritable()` 内（与部署流程同处一地），
 * 本模块只提供**已存在路径**的可达性探测，避免同一判断出现两份实现。
 */
