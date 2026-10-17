/**
 * 技能目录访问的**共享安全层**（2026-10-17 抽出）。
 *
 * `read_skill`（2026-09-23 新增）与 `grep_skill`（2026-10-17 新增）作用在**同一个子树**
 * （`users/{uid}/agents/{agent}/skills`），且必须遵守**同一套安全口径**：技能名限单个目录名、
 * 路径不得越出技能目录（含 realpath 防符号链接逃逸）、只读普通文件、二进制不返回乱码。
 *
 * 抽成单一来源的原因与宪章原则二一致：**安全判据不允许有两份**——各写一份迟早漂移，
 * 而漂移的那一份就是漏洞。本模块只回答"能不能访问"，不含任何检索或渲染逻辑。
 *
 * 判据与平台侧的 `resolveInsideSkill` / `isSafeSkillName` / `unsafeEntryReason` 一致
 * （`specs/001-digital-human-platform/contracts/runtime-api-delta.md` §1.4.1）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 默认入口文件（与 SKILL 约定一致：SKILL.md 是技能正文入口） */
export const DEFAULT_ENTRY = 'SKILL.md';

/** 列清单时的条数上限（防止把上下文打爆） */
export const MAX_LISTED_ENTRIES = 50;

/**
 * 越权访问（非法技能名 / 路径越界 / 符号链接 / 非普通文件）。
 *
 * 与"文件不存在""二进制"等**预期内的用法问题分家**：后者以可读文本返回（模型可自我纠正），
 * 本类才上抛，由 `infra/builtin-tools.ts` 记 alert 日志并按拒绝文案返回。
 */
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

/** 技能内相对路径：缺省为 `SKILL.md`；绝对路径/盘符/控制字符一律拒，`\` 归一为 `/` */
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

/** 解析到技能目录内；越界即抛（`..` 穿越与符号链接逃逸都在此拦住） */
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

/**
 * 列出 `from` 之下的文件，路径**一律相对技能根** `skillRoot`（可直接回填给 `path`），
 * 排序、有界；符号链接不计入。
 */
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

/** 可用技能名清单（"技能不存在"时的可读提示） */
export function availableSkills(skillsRoot: string): string {
  const names = listSkillNames(skillsRoot);
  return names.length > 0 ? names.join('、') : '（无）';
}

/**
 * 二进制判定（与平台侧同一口径：**看字节 0**，不看扩展名）。
 *
 * 用途是"别把乱码塞给模型"：命中即返回一句说明，而不是把 NUL 字节渲染进上下文。
 */
export function isBinaryBuffer(buf: Buffer): boolean {
  return buf.includes(0);
}
