import { parse as parseYaml } from 'yaml';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';

export interface OntologyMetadata {
  created_at: string | null;
  deployed_version: string | null;
  scenario_name: string | null;
  scenario_id: string | number | null;
  ontology_name: string | null;
  ontology_id: string | number | null;
}

export const ONTOLOGY_METADATA_KEYS = [
  'created_at',
  'deployed_version',
  'scenario_name',
  'scenario_id',
  'ontology_name',
  'ontology_id',
] as const;

export type OntologyMetadataKey = (typeof ONTOLOGY_METADATA_KEYS)[number];

export const EMPTY_ONTOLOGY_METADATA: OntologyMetadata = {
  created_at: null,
  deployed_version: null,
  scenario_name: null,
  scenario_id: null,
  ontology_name: null,
  ontology_id: null,
};

function textOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function idOrNull(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  return null;
}

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
