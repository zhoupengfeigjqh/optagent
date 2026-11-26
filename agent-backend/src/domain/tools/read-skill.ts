import fs from 'node:fs';
import path from 'node:path';

import {
  SkillAccessError,
  availableSkills,
  isBinaryBuffer,
  isDirectory,
  listSkillFiles,
  normalizeSkillRelPath,
  requireSkillName,
  resolveInsideSkill,
} from './skill-access.js';

/** 默认截断上限（字节）；实际由调用方注入，与 `read_file` 同一配置来源 */
const DEFAULT_TRUNCATE_BYTES = 128 * 1024;

export { SkillAccessError };

export interface ReadSkillResult {
  text: string;
  truncated: boolean;
  totalSize: number;
}

export interface ReadSkillOptions {
  offset?: number | undefined;
  /** 本次最多返回字节数（上限为 `truncateBytes`） */
  limit?: number | undefined;
  /** 截断上限（字节），默认 128KB */
  truncateBytes?: number | undefined;
}

export function readSkillFile(
  skillsRoot: string,
  skill: unknown,
  relPath?: unknown,
  opts: ReadSkillOptions = {},
): ReadSkillResult {
  const skillName = requireSkillName(skill);
  const skillDir = path.join(skillsRoot, skillName);
  if (!isDirectory(skillDir)) {
    return note(`本数字人没有名为「${skillName}」的技能。可用技能：${availableSkills(skillsRoot)}`);
  }

  const rel = normalizeSkillRelPath(relPath);
  const abs = resolveInsideSkill(skillDir, rel);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return note(
      `技能「${skillName}」下没有「${rel}」。可用文件：\n${listSkillFiles(skillDir, skillDir) || '（空）'}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new SkillAccessError(`不接受符号链接：${skillName}/${rel}`);
  }
  if (stat.isDirectory()) {
    return note(
      `技能「${skillName}」下「${rel}」是目录，包含：\n${listSkillFiles(skillDir, abs) || '（空目录）'}`,
    );
  }
  if (!stat.isFile()) {
    throw new SkillAccessError(`只读取普通文件：${skillName}/${rel}`);
  }

  const buf = fs.readFileSync(abs);
  if (isBinaryBuffer(buf)) {
    return note(`「${skillName}/${rel}」是二进制文件（${buf.length} 字节），无法直接阅读`);
  }

  const truncateBytes = opts.truncateBytes ?? DEFAULT_TRUNCATE_BYTES;
  const offset = Math.max(opts.offset ?? 0, 0);
  const limit = Math.min(opts.limit ?? truncateBytes, truncateBytes);
  const slice = buf.subarray(offset, offset + limit).toString('utf8');
  const consumed = offset + Buffer.byteLength(slice, 'utf8');
  const truncated = consumed < buf.length;
  return {
    text: truncated
      ? `${slice}\n\n[内容已截断：本次返回至第 ${consumed} 字节，共 ${buf.length} 字节；` +
        `可用 offset=${consumed} 继续读取]`
      : slice,
    truncated,
    totalSize: buf.length,
  };
}

function note(text: string): ReadSkillResult {
  return { text, truncated: false, totalSize: 0 };
}
