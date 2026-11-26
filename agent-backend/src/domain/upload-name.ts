import fs from 'node:fs';
import path from 'node:path';

import { removeFileSafe } from './fs-safe.js';

/** 候选名尝试上限（含原名）：用尽即显式失败，不做无限重试 */
export const MAX_NAME_ATTEMPTS = 999;

/**
 * 主名保留的最大**字符**数（不含编号与扩展名）。
 * 取 200 的保守值，同时兼容 NTFS（255 字符）与 ext4（255 字节，中文按 3 字节计 ≈ 65 字符）之外的
 * 常见文件系统；仍超目标系统上限时由 `ENAMETOOLONG` 兜底成 400，不静默截断成不可预期的名字。
 */
export const MAX_BASE_CHARS = 200;

export class UploadNameConflictError extends Error {
  constructor(readonly original: string) {
    super(`同名文件过多，无法生成唯一文件名：${original}`);
    this.name = 'UploadNameConflictError';
  }
}

/** 候选名超出目标文件系统的名长上限 */
export class UploadNameTooLongError extends Error {
  constructor(readonly original: string) {
    super(`文件名过长，无法落盘：${original}`);
    this.name = 'UploadNameTooLongError';
  }
}

/** 主名 / 扩展名切分：沿用既有口径（`basename` + `/\`→`_`，`path.extname`，空主名兜底 `file`） */
export function splitName(original: string): { stem: string; ext: string } {
  const base = path.basename(original).replace(/[/\\]/g, '_');
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || 'file';
  return { stem, ext };
}

function clampStem(stem: string, suffix: string): string {
  const chars = Array.from(stem);
  const limit = Math.max(1, MAX_BASE_CHARS - Array.from(suffix).length);
  return chars.length <= limit ? stem : chars.slice(0, limit).join('');
}

export function candidateName(original: string, index: number): string {
  const { stem, ext } = splitName(original);
  const suffix = index <= 0 ? '' : `(${index})`;
  return `${clampStem(stem, `${suffix}${ext}`)}${suffix}${ext}`;
}

/** `link` 不可用的错误码（须回退到独占复制）；其余错误（磁盘满 / 权限）直接上抛 */
const LINK_FALLBACK_CODES = new Set(['EPERM', 'EXDEV', 'ENOTSUP', 'EMLINK', 'EACCES']);

function placeExclusive(staging: string, dest: string): void {
  try {
    fs.linkSync(staging, dest);
    removeFileSafe(staging);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || !LINK_FALLBACK_CODES.has(code ?? '')) throw err;
  }
  fs.copyFileSync(staging, dest, fs.constants.COPYFILE_EXCL);
  removeFileSafe(staging);
}

export function claimName(
  dirAbs: string,
  original: string,
  staging: string,
  maxAttempts: number = MAX_NAME_ATTEMPTS,
): string {
  for (let index = 0; index <= maxAttempts; index += 1) {
    const name = candidateName(original, index);
    try {
      placeExclusive(staging, path.join(dirAbs, name));
      return name;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      if (code === 'ENAMETOOLONG') throw new UploadNameTooLongError(original);
      throw err;
    }
  }
  throw new UploadNameConflictError(original);
}
