import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ENTRY = 'SKILL.md';

/** 列清单时的条数上限（防止把上下文打爆） */
export const MAX_LISTED_ENTRIES = 50;

export class SkillAccessError extends Error {
  readonly code = 'SKILL_ACCESS_DENIED';
  constructor(message: string) {
    super(message);
    this.name = 'SkillAccessError';
  }
}

/**
 * 是否含控制字符（C0 与 DEL）。
 *
 * 判据与平台侧的 `isSafeSkillName` / `unsafeEntryReason` **一致**（`/[\u0000-\u001f\u007f]/`），
 * 只是改用逐字符判定：那两处要靠 `eslint-disable no-control-regex` 压规则，
 * 而这里显式循环更清楚，也不必压。
 */
export function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 技能名必须是单个目录名：非空、不含分隔符/盘符前缀/`..`/控制字符 */
export function requireSkillName(skill: unknown): string {
  if (typeof skill !== 'string' || skill.trim() === '') {
    throw new SkillAccessError('skill 不能为空');
  }
  const name = skill.trim();
  if (/[/\\]/.test(name) || name.includes('..') || hasControlChar(name)) {
    throw new SkillAccessError(`非法技能名：${skill}`);
  }
  return name;
}

export function normalizeSkillRelPath(relPath: unknown): string {
  if (relPath === undefined || relPath === null) return DEFAULT_ENTRY;
  if (typeof relPath !== 'string') {
    throw new SkillAccessError(`path 须为字符串：${String(relPath)}`);
  }
  const rel = relPath.trim().replace(/\\/g, '/');
  if (rel === '') return DEFAULT_ENTRY;
  if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
    throw new SkillAccessError(`拒绝绝对路径：${relPath}`);
  }
  if (hasControlChar(rel)) {
    throw new SkillAccessError(`路径含控制字符：${relPath}`);
  }
  return rel;
}

export function resolveInsideSkill(skillDir: string, rel: string): string {
  const abs = path.resolve(skillDir, rel);
  const inside = path.relative(skillDir, abs);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new SkillAccessError(`路径越界（技能目录之外）：${rel}`);
  }
  // 已存在的真实路径也必须仍在技能目录内：中间目录可能是指向外部的符号链接
  if (fs.existsSync(abs)) {
    const realRoot = fs.realpathSync(skillDir);
    const realRel = path.relative(realRoot, fs.realpathSync(abs));
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new SkillAccessError(`路径越界（符号链接指向技能目录之外）：${rel}`);
    }
  }
  return abs;
}

export function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

export function listSkillFiles(skillRoot: string, from: string): string {
  const out: string[] = [];
  const walk = (current: string): void => {
    if (out.length >= MAX_LISTED_ENTRIES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= MAX_LISTED_ENTRIES) return;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) out.push(path.relative(skillRoot, child));
    }
  };
  walk(from);
  return out
    .map((rel) => rel.split(path.sep).join('/'))
    .sort()
    .join('\n');
}

/** 本数字人的技能名清单（目录名，排序；不存在或不可读时为空数组） */
export function listSkillNames(skillsRoot: string): string[] {
  try {
    return fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function availableSkills(skillsRoot: string): string {
  const names = listSkillNames(skillsRoot);
  return names.length > 0 ? names.join('、') : '（无）';
}

export function isBinaryBuffer(buf: Buffer): boolean {
  return buf.includes(0);
}
