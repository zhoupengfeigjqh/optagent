/**
 * `SKILL.md` 元数据块解析（`FR-038`，`data-model.md` §4 校验项 3/4）。
 *
 * 与运行环境 `agent-instance.ts` 的 `parseFrontmatter` **同口径**
 * （YAML frontmatter 中的 `name` / `description`），避免出现"平台装得上、
 * 运行环境读不出"的两套格式实现（原则二）。
 *
 * 平台侧收紧的一点：安装进共享技能库要求 `name` **可作目录名**
 * （不含路径分隔符、`..`、控制字符），否则 `SKILL_ARCHIVE_INVALID` / `VALIDATION_FAILED`。
 */
import { parse as parseYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface SkillMetadata {
  name: string;
  description: string;
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

/**
 * 解析 `SKILL.md` 的 YAML frontmatter。
 *
 * 任何解析失败（缺 frontmatter / 缺字段 / 字段为空）都属于**格式校验失败**
 * → `ADM_SKILL_ARCHIVE_INVALID`，并给出**具体原因**（`FR-009` 可读）。
 */
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
    throw new ApiError(
      ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
      'SKILL.md 元数据缺少非空的 description',
    );
  }
  if (!isSafeSkillName(name)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `SKILL 名称不可作为目录名：${JSON.stringify(name)}（不得含路径分隔符、".." 或控制字符）`,
    );
  }
  return { name, description };
}
