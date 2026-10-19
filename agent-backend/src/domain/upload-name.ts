/**
 * 上传文件落盘命名（012）：**不重名用原名**，重名用 `原名(n).ext`（半角括号，紧贴主名）。
 *
 * 为什么落在 `domain/`：宪章原则二要求"接口层 MUST NOT 直接读写文件系统"。本模块是命名规则的
 * **唯一实现**（候选名生成 + 排他占名），路由只调用，MUST NOT 自行推算后缀。
 *
 * 并发唯一性（012 FR-022）——"检查 + 占位"在同一次系统调用内完成：
 * 1. `linkSync(staging, dest)`：已存在即 `EEXIST`（NTFS / ext4 均为原子语义）；
 * 2. 不支持硬链接（`EPERM` / `EXDEV` / `ENOTSUP` / `EMLINK`）时回退
 *    `copyFileSync(staging, dest, COPYFILE_EXCL)`——同样"已存在即失败"，**绝不覆盖**。
 *
 * 因此"是否同名"由**目标文件系统**回答：大小写不敏感的平台（Windows/macOS）上
 * `Report.csv` 与 `report.csv` 天然冲突（FR-023），代码里不写第二套平台规则。
 *
 * 失败口径（原则九：重试有界、失败显式）：候选名用尽 → `UploadNameConflictError`（路由映射 409）；
 * 追加编号后仍超系统名长 → `UploadNameTooLongError`（路由映射 400）。
 */
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

/** 候选名用尽：同名文件过多，无法在有限次尝试内找到唯一名 */
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

/** 按**码点**截断主名，给编号与扩展名留位（不切开代理对） */
function clampStem(stem: string, suffix: string): string {
  const chars = Array.from(stem);
  const limit = Math.max(1, MAX_BASE_CHARS - Array.from(suffix).length);
  return chars.length <= limit ? stem : chars.slice(0, limit).join('');
}

/**
 * 第 `index` 个候选名：`0` ⇒ 原名；`n` ⇒ `主名(n)扩展名`。
 * 编号只出现在主名与扩展名之间，保证 `a.tar.gz` ⇒ `a.tar(1).gz`、`README` ⇒ `README(1)`、`.env` ⇒ `.env(1)`。
 */
export function candidateName(original: string, index: number): string {
  const { stem, ext } = splitName(original);
  const suffix = index <= 0 ? '' : `(${index})`;
  return `${clampStem(stem, `${suffix}${ext}`)}${suffix}${ext}`;
}

/** `link` 不可用的错误码（须回退到独占复制）；其余错误（磁盘满 / 权限）直接上抛 */
const LINK_FALLBACK_CODES = new Set(['EPERM', 'EXDEV', 'ENOTSUP', 'EMLINK', 'EACCES']);

/**
 * 把暂存文件**独占**放到 `dest`：
 * - 成功 ⇒ 暂存文件已被硬链接接管，删除暂存名（数据仍在 `dest`）；
 * - `dest` 已存在 ⇒ 抛 `EEXIST`（由调用方换下一个编号）。
 */
function placeExclusive(staging: string, dest: string): void {
  try {
    fs.linkSync(staging, dest);
    removeFileSafe(staging);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || !LINK_FALLBACK_CODES.has(code ?? '')) throw err;
  }
  // 回退：独占复制（COPYFILE_EXCL 同样"已存在即失败"）
  fs.copyFileSync(staging, dest, fs.constants.COPYFILE_EXCL);
  removeFileSafe(staging);
}

/**
 * 在 `dirAbs` 内为 `staging` 找一个唯一落盘名并**完成落盘**，返回该名字。
 *
 * `maxAttempts` 仅供测试注入小值（生产用 `MAX_NAME_ATTEMPTS`）。
 * 调用方负责：目标目录已存在（`mkdirSync` 已做）、`staging` 已写完并通过校验、
 * 失败时清理 `staging`（本函数只在成功时删除它）。
 */
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
