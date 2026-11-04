/**
 * 技能头部（SKILL.md frontmatter）读取与解析（016）。
 *
 * 为什么只读头部：本体技能聚焦只需要 `name` / `description` / `metadata`，正文（概念表、
 * 流程、示例）体量大且与"技能是否切题"无关；读了正文会让每轮聚焦多几十 KB IO，并把
 * 判定素材与正文描述混在一起。
 *
 * 有界读取（默认 64KB）而非整文件：单个 SKILL.md 实测已到 18KB，正文继续膨胀时
 * "读进来再切" 的成本会随文件线性增长；头部永远在最前面，读前 64KB 足够覆盖任何
 * 合法 frontmatter，同时给异常文件一个硬上限。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** 头部读取上限：任何合法 frontmatter 都远小于此值 */
export const SKILL_HEADER_MAX_BYTES = 64 * 1024;

/** 技能头部里与聚焦相关的元数据（全部归一化为字符串或 null） */
export interface SkillHeaderMetadata {
  ontologyId: string | null;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
}

/** 一个技能的判定用头部 */
export interface SkillHeader {
  /** frontmatter `name`（技能标识，提示里保留原文） */
  name: string;
  /** frontmatter `description`（技能用途，提示里截断到 80 字） */
  description: string;
  /** 目录名（`skills/{dirName}/SKILL.md`），排障与留档用 */
  dirName: string;
  metadata: SkillHeaderMetadata;
}

export interface SkillHeaderLoadResult {
  skills: SkillHeader[];
  /** 读取 / 解析失败的原因（逐技能，不中断其他技能） */
  warnings: string[];
}

/** 解析失败的原因分类（测试与日志可区分，不向用户暴露） */
export class SkillHeaderError extends Error {
  constructor(
    message: string,
    readonly reason: 'missing_frontmatter' | 'invalid_yaml' | 'missing_fields',
  ) {
    super(message);
    this.name = 'SkillHeaderError';
  }
}

/**
 * 读取并解析单个 SKILL.md 的头部。
 *
 * 只读前 `SKILL_HEADER_MAX_BYTES`：`readSync` 定点读取，避免把正文读进内存；
 * frontmatter 未闭合（即 64KB 内没有第二个 `---`）按 `missing_frontmatter` 处理。
 */
export function readSkillHeaderFile(file: string, dirName = path.basename(path.dirname(file))): SkillHeader {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(SKILL_HEADER_MAX_BYTES);
    const read = fs.readSync(fd, buffer, 0, SKILL_HEADER_MAX_BYTES, 0);
    return parseSkillHeader(buffer.subarray(0, read).toString('utf8'), dirName);
  } finally {
    fs.closeSync(fd);
  }
}

/** 解析头部文本（纯函数，便于单测逐字断言） */
export function parseSkillHeader(raw: string, dirName = ''): SkillHeader {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) {
    throw new SkillHeaderError('SKILL.md 缺少 YAML frontmatter', 'missing_frontmatter');
  }

  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch (err) {
    throw new SkillHeaderError(
      `SKILL.md frontmatter 不是合法 YAML：${(err as Error).message}`,
      'invalid_yaml',
    );
  }
  if (typeof data !== 'object' || data === null) {
    throw new SkillHeaderError('SKILL.md frontmatter 不是对象', 'missing_fields');
  }

  const record = data as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const description = typeof record.description === 'string' ? record.description.trim() : '';
  if (name === '' || description === '') {
    throw new SkillHeaderError('SKILL.md frontmatter 须含非空 name 与 description', 'missing_fields');
  }

  const metadata = typeof record.metadata === 'object' && record.metadata !== null
    ? (record.metadata as Record<string, unknown>)
    : {};

  return {
    name,
    description,
    dirName,
    metadata: {
      ontologyId: normalizeId(metadata.ontology_id),
      ontologyName: normalizeText(metadata.ontology_name),
      scenarioId: normalizeId(metadata.scenario_id),
      scenarioName: normalizeText(metadata.scenario_name),
    },
  };
}

/**
 * 枚举并解析 `{agentDir}/skills/*\/SKILL.md`。
 *
 * 只读**已物化**到该数字人目录下的技能（FR-005）；单个技能失败只记 warning，
 * 不阻断其余技能——一个坏文件不该让整轮聚焦失效。
 */
export function loadSkillHeaders(agentDir: string): SkillHeaderLoadResult {
  const skillsDir = path.join(agentDir, 'skills');
  const skills: SkillHeader[] = [];
  const warnings: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    // 目录不存在 = 该数字人没有关联技能，属正常空集，不算告警
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`skills 目录不可读：${(err as Error).message}`);
    }
    return { skills, warnings };
  }

  for (const entry of entries) {
    // 符号链接一律跳过：技能目录由平台整体下发，出现链接说明物化异常
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const file = path.join(skillsDir, entry.name, 'SKILL.md');
    try {
      skills.push(readSkillHeaderFile(file, entry.name));
    } catch (err) {
      const reason = err instanceof SkillHeaderError ? err.reason : 'unreadable';
      warnings.push(`${entry.name}:${reason}`);
    }
  }

  return { skills, warnings };
}

/** `ontology_id` / `scenario_id` 归一化：去空白、数字转字符串，空值归 null */
export function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
