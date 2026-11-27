import { parse as parseYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface SkillMetadata {
  name: string;
  description: string;
  display_name: string;
}

const DISPLAY_NAME_KEYS = ['name', 'title', 'ontology_name', 'display_name'] as const;

function firstNonEmptyText(source: Record<string, unknown>): string | null {
  for (const key of DISPLAY_NAME_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

function readMetadataBlock(obj: Record<string, unknown>): Record<string, unknown> | null {
  const block = obj.metadata;
  if (block === null || block === undefined || typeof block !== 'object' || Array.isArray(block)) {
    return null;
  }
  return block as Record<string, unknown>;
}

/** 可作目录名的名称校验（与数字人名同一口径，下沉到路径安全） */
export function isSafeSkillName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0 || name.length > 64) return false;
  if (name === '.' || name === '..') return false;
  if (/[/\\]/.test(name)) return false;
  if (name.includes('..')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) return false;
  return true;
}

export function parseSkillMetadata(raw: string): SkillMetadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!match) {
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
      'SKILL.md 缺少 YAML frontmatter（需以 --- 包裹的元数据块）',
    );
  }
  let data: unknown;
  try {
    data = parseYaml(match[1]!);
  } catch (err) {
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
      `SKILL.md 的 frontmatter 不是合法 YAML：${(err as Error).message}`,
    );
  }
  const obj = (data ?? {}) as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  if (name === '') {
    throw new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID, 'SKILL.md 元数据缺少非空的 name');
  }
  if (description === '') {
    throw new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID, 'SKILL.md 元数据缺少非空的 description');
  }
  if (!isSafeSkillName(name)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `SKILL 名称不可作为目录名：${JSON.stringify(name)}（不得含路径分隔符、".." 或控制字符）`,
    );
  }
  const block = readMetadataBlock(obj);
  const displayName = (block !== null ? firstNonEmptyText(block) : null) ?? name;
  return { name, description, display_name: displayName };
}
