/**
 * 技能内**单个文件**的读取与在线编辑（`FR-036`，2026-09-16 产品决定：全部文件可编辑）。
 *
 * 与 `install.ts` 的分工：
 * - 本模块只管"**一个文件**"：路径安全、体积与二进制判据、乐观锁、原子写入；
 * - `install.ts` 管"**一个技能**"：`index.json`、整包安装/覆盖/删除。
 * 因此索引同步（描述、附件大小、`updated_at`）留在 `install.ts`——本模块对索引无感知，
 * 只把"改的是 SKILL.md 时解析出的新描述"回传出去。
 *
 * 与安装侧**同一套安全口径**（复用 `unsafeEntryReason` / `normalizeEntryName`）：
 * 进不来的条目（绝对路径、盘符、`..`、控制字符）在这里同样读不到、也写不进去。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { PlatformStore } from '../../infra/platform-store.js';
import { normalizeEntryName, unsafeEntryReason } from './archive.js';
import { parseSkillMetadata } from './metadata.js';

/** 技能库根目录（相对设计态根）；技能目录为 `skills/{name}` */
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
  /** 二进制文件（含 NUL 或非 UTF-8）：不返回 content */
  binary: boolean;
  truncated: boolean;
  content: string | null;
  /** 内容哈希（sha256）：编辑保存时作为乐观锁基准 */
  hash: string;
  /** 是否可在线编辑：**文本且完整**（二进制与超限文件不可编辑） */
  editable: boolean;
}

/** 本模块的依赖 */
export interface SkillFileDeps {
  store: PlatformStore;
}

/** 编辑结果（索引同步所需的最小信息） */
export interface SkillFileWriteOutcome {
  path: string;
  size: number;
  hash: string;
  /** 改的是 `SKILL.md` 时为按新正文解析出的描述；其他文件为 `null` */
  description: string | null;
}

/** 内容哈希（sha256，十六进制）——编辑的乐观锁基准 */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/** 严格 UTF-8 解码；含 NUL 字节或解码失败 → null（视为二进制） */
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

/**
 * 读取技能内单个文件。
 *
 * 只返回**目录内真实存在的普通文件**（目录、符号链接一律不返回）；
 * 二进制不返回正文只返回大小；超出预览上限只返回前 N 字节并置 `truncated`。
 *
 * 返回 `hash` / `editable` 供编辑使用：`editable` 为假时界面不给编辑入口，
 * `writeSkillFile` 也以同一判据拒绝（界面与服务端同一口径，不存在"能点但存不了"）。
 */
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

/**
 * 编辑并保存技能内单个文件。
 *
 * 1. 路径安全复用 `resolveInsideSkill`（绝对路径 / `..` / 控制字符 / 越界一律拒）；
 * 2. 并发保护用 `baseHash`（客户端读到的内容哈希）——不符即 `ADM_CONFIG_REVISION_CONFLICT`，
 *    **MUST NOT 静默覆盖**他人的改动；
 * 3. 只允许编辑**文本且完整**的文件（二进制、超限文件拒写，判据与 `readSkillFile` 的 `editable` 一致）；
 * 4. 写入"临时文件 → `fsync` → 原子 `rename`"，失败不留半截文件、也不改动原文件。
 *
 * **保存即覆盖、无法恢复**（2026-09-16 产品决定：撤销"编辑快照"）：不产生任何副本，
 * 因此界面 MUST 在保存前**二次确认**并把这条后果讲明（见 `SkillFileEditor.vue`）。
 *
 * 改 `SKILL.md` 时额外校验：`name` MUST 与技能名一致——技能名是各数字人的引用键，
 * 改名必须走重新安装，否则会**静默打断**引用（`FR-019`）。
 */
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
    description = metadata.description;
  }

  writeAtomicFile(deps, abs, bytes);

  return { path: normalized, size: bytes.length, hash: contentHash(bytes), description };
}

/**
 * 原子写入单个文件：临时文件 → `fsync` → `rename`。
 *
 * 临时文件建在**技能目录之外的 `skills/` 根**下（同一文件系统，`rename` 不跨设备）：
 * 这样"写一半"的中间态**永远不会出现在技能目录里**——否则并发的部署物化
 * 可能把这个临时文件当成技能内容拷进数字人目录。
 * 失败时原文件**未被改动**，且临时文件被清理。
 */
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
      fs.rmSync(tmp, { force: true });
    } catch {
      /* 清理临时文件失败不影响报错语义 */
    }
    throw new ApiError(
      ERROR_CODES.ADM_STORAGE_UNAVAILABLE,
      `保存技能文件失败（原文件未被改动）：${(err as Error).message}`,
    );
  }
}
