/**
 * `read_skill` 工具的领域实现（2026-09-23）。
 *
 * **补的是一个真实缺口**：SKILL 此前只把 frontmatter 的 `name`/`description` 注入
 * System Prompt（见 `agent-instance.ts`），**正文与 `references/` 附件没有任何读取通道**——
 * 内置文件的沙箱 `FileAccess` 只覆盖用户三空间（`users/{uid}/user-data/{数据准备|共享空间|临时空间}`），
 * 而技能在 `users/{uid}/agents/{agent}/skills/` 下，是**另一个子树**，`read_file` 一律被拒。
 *
 * 安全口径（与 `admin-backend` 的 `resolveInsideSkill` 同一判据，**只读**）：
 * - 路径规范化：拒绝绝对路径、盘符、`..` 穿越、控制字符；`\` 按分隔符归一；
 * - 解析后必须落在**该技能目录内**（`path.relative` 前缀校验）+ realpath 校验（防符号链接逃逸）；
 * - 只读**真实存在的普通文件**；目录返回其文件清单（而非报错）；符号链接一律拒绝；
 * - 技能名限定为**单个目录名**，且必须真实存在于本数字人的技能目录下——天然隔离到
 *   "本数字人"，读不到别的数字人、也读不到别的用户的技能。
 *
 * 与 `read_file` 的分工：那条服务于**用户数据**（三空间、支持 xlsx/pdf 解析）；
 * 这条服务于**技能文档**（技能根、纯文本，不做格式解析）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 默认入口文件（与 SKILL 约定一致：SKILL.md 是技能正文入口） */
const DEFAULT_ENTRY = 'SKILL.md';
/** 列清单时的条数上限（防止把上下文打爆） */
const MAX_LISTED_ENTRIES = 50;
/** 默认截断上限（字节）；实际由调用方注入，与 `read_file` 同一配置来源 */
const DEFAULT_TRUNCATE_BYTES = 32 * 1024;

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

export interface ReadSkillResult {
  /** 交给模型的文本（含截断提示，或可读的失败/清单说明） */
  text: string;
  truncated: boolean;
  totalSize: number;
}

export interface ReadSkillOptions {
  /** 字节偏移（续读截断内容时用） */
  offset?: number | undefined;
  /** 本次最多返回字节数（上限为 `truncateBytes`） */
  limit?: number | undefined;
  /** 截断上限（字节），默认 32KB */
  truncateBytes?: number | undefined;
}

/**
 * 读取技能内的文件。
 *
 * @param skillsRoot 本数字人的技能根（`users/{uid}/agents/{agent}/skills`）
 * @param skill 技能名（单个目录名）
 * @param relPath 技能内相对路径；缺省/空串为 `SKILL.md`
 */
export function readSkillFile(
  skillsRoot: string,
  skill: unknown,
  relPath?: unknown,
  opts: ReadSkillOptions = {},
): ReadSkillResult {
  const skillName = requireSkillName(skill);
  const skillDir = path.join(skillsRoot, skillName);
  if (!isDirectory(skillDir)) {
    // 名字合法但不存在：属用法问题（可能只是记错了名字），给可读提示而非越权告警
    return note(`本数字人没有名为「${skillName}」的技能。可用技能：${availableSkills(skillsRoot)}`);
  }

  const rel = normalizeRelPath(relPath);
  const abs = resolveInside(skillDir, rel);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch {
    return note(
      `技能「${skillName}」下没有「${rel}」。可用文件：\n${listFiles(skillDir, skillDir) || '（空）'}`,
    );
  }
  if (stat.isSymbolicLink()) {
    throw new SkillAccessError(`不接受符号链接：${skillName}/${rel}`);
  }
  if (stat.isDirectory()) {
    // 清单一律**相对技能根**，模型可直接回填给 path（相对被问目录的写法回填后会取不到）
    return note(
      `技能「${skillName}」下「${rel}」是目录，包含：\n${listFiles(skillDir, abs) || '（空目录）'}`,
    );
  }
  if (!stat.isFile()) {
    throw new SkillAccessError(`只读取普通文件：${skillName}/${rel}`);
  }

  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) {
    // 二进制（字节 0 判定，与 admin 侧同一口径）：不返回乱码，明说原因与体积
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

/**
 * 是否含控制字符（C0 与 DEL）。
 *
 * 判据与平台侧的 `isSafeSkillName` / `unsafeEntryReason` **一致**（`/[\u0000-\u001f\u007f]/`），
 * 只是改用逐字符判定：那两处要靠 `eslint-disable no-control-regex` 压规则，
 * 而这里显式循环更清楚，也不必压。
 */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** 技能名必须是单个目录名：非空、不含分隔符/盘符前缀/`..`/控制字符 */
function requireSkillName(skill: unknown): string {
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
function normalizeRelPath(relPath: unknown): string {
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
function resolveInside(skillDir: string, rel: string): string {
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

function isDirectory(dir: string): boolean {
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
function listFiles(skillRoot: string, from: string): string {
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
  return out.map((rel) => rel.split(path.sep).join('/')).sort().join('\n');
}

/** 可用技能名清单（"技能不存在"时的可读提示） */
function availableSkills(skillsRoot: string): string {
  try {
    const names = fs
      .readdirSync(skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return names.length > 0 ? names.join('、') : '（无）';
  } catch {
    return '（无）';
  }
}
