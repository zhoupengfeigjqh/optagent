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
  /**
   * 界面展示名（2026-11-04）：优先 `metadata.name` → `metadata.title` →
   * `metadata.ontology_name` → `metadata.display_name`，全部缺失/为空则回落顶层 `name`。
   *
   * **只用于展示**：`name` 仍是技能的身份（技能库目录名、数字人引用键、市场更新匹配键），
   * 把 `name` 换成展示名会打断数字人引用与已部署副本，因此两者严格分离。
   */
  display_name: string;
}

/** `metadata` 段里按优先级取展示名的键 */
const DISPLAY_NAME_KEYS = ['name', 'title', 'ontology_name', 'display_name'] as const;

/** 按 `DISPLAY_NAME_KEYS` 取第一个**非空字符串**（非字符串/空白视为缺失，继续往后找） */
function firstNonEmptyText(source: Record<string, unknown>): string | null {
  for (const key of DISPLAY_NAME_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
  }
  return null;
}

/** `metadata` 段：非对象/数组/缺失均为 `null`——展示名"有则用之"，不阻塞安装 */
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
