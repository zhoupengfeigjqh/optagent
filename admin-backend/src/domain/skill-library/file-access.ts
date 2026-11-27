import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { removeTree } from '../../infra/fs-remove.js';
import { normalizeEntryName, unsafeEntryReason } from './archive.js';
import { parseSkillMetadata } from './metadata.js';

export const SKILLS_DIR = 'skills';

/** 单次读取返回正文的字节上限（超出只给前 N 字节并标注 truncated） */
export const MAX_PREVIEW_BYTES = 256 * 1024;

/**
 * 在线编辑的字节上限，**与预览上限同为 256KB**。
 *
 * 有意让两者相等：只有"能完整看到"的文件才允许在线改写。
 * 否则会出现"编辑一个只显示了前 256KB 的文件"——保存即静默丢掉其余内容。
 * 超出后改用 ZIP 覆盖安装（那时没有这个限制）。
 */
export const MAX_EDIT_BYTES = MAX_PREVIEW_BYTES;

export interface SkillFileContent {
  name: string;
  path: string;
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string | null;
  hash: string;
  /** 是否可在线编辑：**文本且完整**（二进制与超限文件不可编辑） */
  editable: boolean;
}

export interface SkillFileDeps {
  store: PlatformStore;
}

export interface SkillFileWriteOutcome {
  path: string;
  size: number;
  hash: string;
  display_name: string | null;
  description: string | null;
}

export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function decodeUtf8(buffer: Buffer): string | null {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

/**
 * 解析技能内文件路径并做安全判定——**读取与写入共用同一套判据**，
 * 避免"读得到却写不进去"或"写得出却能越界"这类两套规则的不一致。
 *
 * `skillDirRel` 是相对设计态根目录的技能目录（`skills/{name}`）。
 */
function resolveInsideSkill(
  deps: SkillFileDeps,
  skillDirRel: string,
  relPath: unknown,
): { abs: string; normalized: string } {
  if (typeof relPath !== 'string' || relPath.trim() === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'path 必填且须为非空字符串');
  }
  const dir = deps.store.abs(skillDirRel);
  if (!fs.existsSync(dir)) {
    throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `SKILL 不存在：${skillDirRel}`);
  }

  // 反斜杠归一后再做安全判定：Windows 客户端传来的 `references\a.md` 同样可读可写
  const normalized = normalizeEntryName(relPath.trim());
  const reason = unsafeEntryReason(normalized);
  if (reason) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `文件路径非法：${reason}`);
  }

  // 前缀校验：解析后的绝对路径必须位于技能目录内（防越界读写）
  const abs = path.resolve(dir, normalized);
  if (abs !== dir && !abs.startsWith(dir + path.sep)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `文件路径越界：${relPath}`);
  }
  return { abs, normalized };
}

export function readSkillFile(
  deps: SkillFileDeps,
  skillDirRel: string,
  name: string,
  relPath: unknown,
): SkillFileContent {
  const { normalized, abs } = resolveInsideSkill(deps, skillDirRel, relPath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `技能内不存在该文件：${normalized}`);
  }
  if (!stat.isFile()) {
    throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `技能内该路径不是文件：${normalized}`);
  }

  const buf = fs.readFileSync(abs);
  const truncated = buf.length > MAX_PREVIEW_BYTES;
  const preview = truncated ? buf.subarray(0, MAX_PREVIEW_BYTES) : buf;
  const text = decodeUtf8(preview);
  const hash = contentHash(buf);
  if (text === null) {
    return {
      name,
      path: normalized,
      size: buf.length,
      binary: true,
      truncated,
      content: null,
      hash,
      editable: false,
    };
  }
  return {
    name,
    path: normalized,
    size: buf.length,
    binary: false,
    truncated,
    content: text,
    hash,
    // 只显示了一部分 → 不许编辑（否则保存即丢掉未显示的部分）
    editable: !truncated,
  };
}

export function writeSkillFile(
  deps: SkillFileDeps,
  skillDirRel: string,
  name: string,
  relPath: unknown,
  content: unknown,
  baseHash: unknown,
): SkillFileWriteOutcome {
  if (typeof content !== 'string') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'content 必填且须为字符串');
  }
  if (typeof baseHash !== 'string' || baseHash.trim() === '') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      'base_hash 必填：保存前须先读取文件，用于判断内容是否已被他处修改',
    );
  }
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > MAX_EDIT_BYTES) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `内容超出在线编辑上限（${Math.round(MAX_EDIT_BYTES / 1024)}KB，当前 ${bytes.length} 字节）；` +
        '大文件请改用 ZIP 覆盖安装',
    );
  }

  const { normalized, abs } = resolveInsideSkill(deps, skillDirRel, relPath);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_NOT_FOUND,
      `技能内不存在该文件（在线编辑只改已存在的文件）：${normalized}`,
    );
  }
  if (!stat.isFile()) {
    throw new ApiError(ERROR_CODES.ADM_SKILL_NOT_FOUND, `技能内该路径不是文件：${normalized}`);
  }

  const previous = fs.readFileSync(abs);
  if (decodeUtf8(previous) === null) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `二进制文件不支持在线编辑：${normalized}；如需替换请重新打包 ZIP 覆盖安装`,
    );
  }
  if (previous.length > MAX_EDIT_BYTES) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `文件超过在线编辑上限（${Math.round(MAX_EDIT_BYTES / 1024)}KB）：${normalized}；` +
        '界面不提供编辑，以免保存时丢掉未显示的部分',
    );
  }

  const currentHash = contentHash(previous);
  if (currentHash !== baseHash.trim()) {
    throw new ApiError(
      ERROR_CODES.ADM_CONFIG_REVISION_CONFLICT,
      `文件已被他处修改（${normalized}），本次保存未执行；请刷新后重新编辑`,
    );
  }

  let displayName: string | null = null;
  let description: string | null = null;
  if (normalized === 'SKILL.md') {
    const metadata = parseSkillMetadata(content);
    if (metadata.name !== name) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `SKILL.md 的 name（${metadata.name}）必须与技能名（${name}）一致；` +
          '改名请重新打包 ZIP 覆盖安装（数字人按名称引用，改名会打断引用）',
      );
    }
    displayName = metadata.display_name;
    description = metadata.description;
  }

  writeAtomicFile(deps, abs, bytes);

  return {
    path: normalized,
    size: bytes.length,
    hash: contentHash(bytes),
    display_name: displayName,
    description,
  };
}

function writeAtomicFile(deps: SkillFileDeps, abs: string, bytes: Buffer): void {
  const tmp = path.join(
    deps.store.abs(SKILLS_DIR),
    `.tmp-edit-${process.pid}-${Date.now()}-${path.basename(abs)}`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, abs);
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        /* 关闭失败不影响主流程的报错 */
      }
    }
    try {
      // 临时文件名带技能文件名（可能是中文），同样不能走 `fs.rmSync`（见 fs-remove.ts）
      removeTree(tmp);
    } catch {
      /* 清理临时文件失败不影响报错语义 */
    }
    throw new ApiError(
      ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
      `保存技能文件失败（原文件未被改动）：${(err as Error).message}`,
    );
  }
}
