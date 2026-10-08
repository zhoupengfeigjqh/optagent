/**
 * 本体市场 `ontology.yaml` 的 `metadata` 段解析（2026-10-03，`FR-058`）。
 *
 * **为什么必须解析 YAML**：卡片要展示的 6 项里，`deployed_version` / `scenario_name` /
 * `ontology_name` **只存在于 `ontology.yaml`**——市场侧 `meta.json` 只有
 * `id` / `scenario_id` / `name` / `description` / `creator` / 时间戳，
 * 取不到这几项（见 `research.md` D2 的 `yaml` 条）。
 *
 * 口径（与 `skill-library/metadata.ts` 同一风格）：
 * - **只取 `metadata` 段**；`concepts` / 关系等其余内容不解析、不建模——卡片与详情
 *   要的是"原文只读"，不是结构化本体模型；
 * - 6 项**缺哪项就是 `null`**（界面显示 `—`），不阻塞导入：市场侧字段可能演进，
 *   把"字段缺失"当成格式错误会让卡片整条不可用；
 * - YAML 语法错误、顶层不是对象、缺 `metadata` 段 → 判为**格式无效**
 *   （`VALIDATION_FAILED` + 可读原因），该条不可导入、不影响其它条目（`FR-009`）。
 */
import { parse as parseYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

/** 卡片展示用的 6 项 metadata（缺项为 `null`） */
export interface OntologyMetadata {
  created_at: string | null;
  deployed_version: string | null;
  scenario_name: string | null;
  scenario_id: string | number | null;
  ontology_name: string | null;
  ontology_id: string | number | null;
}

/** 6 项键名（顺序即界面展示顺序） */
export const ONTOLOGY_METADATA_KEYS = [
  'created_at',
  'deployed_version',
  'scenario_name',
  'scenario_id',
  'ontology_name',
  'ontology_id',
] as const;

export type OntologyMetadataKey = (typeof ONTOLOGY_METADATA_KEYS)[number];

/** 全空 metadata（解析失败前不构造；仅作缺省值便于调用方判空） */
export const EMPTY_ONTOLOGY_METADATA: OntologyMetadata = {
  created_at: null,
  deployed_version: null,
  scenario_name: null,
  scenario_id: null,
  ontology_name: null,
  ontology_id: null,
};

/** 文本归一：字符串去空白后为空即 `null`；数字转字符串（YAML 里 `v1.0` 类值可能被解析成数字）；其余类型丢弃 */
function textOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** id 归一：数字原样保留（界面按数字展示），字符串去空白，其余丢弃 */
function idOrNull(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

/**
 * 解析 `ontology.yaml` 的 `metadata` 段。
 *
 * @throws ApiError(`VALIDATION_FAILED`) YAML 非法 / 顶层不是对象 / 缺 `metadata` 段
 */
export function parseOntologyMetadata(raw: string): OntologyMetadata {
  let data: unknown;
  try {
    data = parseYaml(raw);
  } catch (err) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `ontology.yaml 不是合法 YAML：${(err as Error).message}`,
    );
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'ontology.yaml 顶层不是对象（缺少 metadata 段）');
  }
  const block = (data as Record<string, unknown>).metadata;
  if (block === null || block === undefined || typeof block !== 'object' || Array.isArray(block)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'ontology.yaml 缺少 metadata 段');
  }
  const source = block as Record<string, unknown>;
  return {
    created_at: textOrNull(source.created_at),
    deployed_version: textOrNull(source.deployed_version),
    scenario_name: textOrNull(source.scenario_name),
    scenario_id: idOrNull(source.scenario_id),
    ontology_name: textOrNull(source.ontology_name),
    ontology_id: idOrNull(source.ontology_id),
  };
}

/** 卡片标题用：优先 `metadata.ontology_name`，缺失时由调用方兜底为目录名 */
export function ontologyDisplayName(metadata: OntologyMetadata, fallback: string): string {
  return typeof metadata.ontology_name === 'string' && metadata.ontology_name !== ''
    ? metadata.ontology_name
    : fallback;
}
