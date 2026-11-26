import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

/** 头部读取上限：任何合法 frontmatter 都远小于此值 */
export const SKILL_HEADER_MAX_BYTES = 64 * 1024;

export interface SkillHeaderMetadata {
  ontologyId: string | null;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
}

export interface SkillHeader {
  name: string;
  description: string;
  dirName: string;
  metadata: SkillHeaderMetadata;
}

export interface SkillHeaderLoadResult {
  skills: SkillHeader[];
  warnings: string[];
}

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

export function loadSkillHeaders(agentDir: string): SkillHeaderLoadResult {
  const skillsDir = path.join(agentDir, 'skills');
  const skills: SkillHeader[] = [];
  const warnings: string[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`skills 目录不可读：${(err as Error).message}`);
    }
    return { skills, warnings };
  }

  for (const entry of entries) {
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
