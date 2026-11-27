import path from 'node:path';

import {
  listOntologyDirs,
  ontologyDirSignature,
  readYamlObject,
  type OntologyDirRef,
} from './ontology-files.js';

/** `ontology.yaml` 文件名（与 `securities.yaml` 区分，避免写成常量表） */
const ONTOLOGY_FILE = 'ontology.yaml';

const WARNING_LABEL = 'ontology';

export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * `op_type` 归一（2026-11-24）：去首尾空白 + 小写。
 *
 * 唯一口径：规则闸门（三态裁决）与意图聚焦（`op_type: query` 取数）共用，
 * 避免"同一字段两套比较规则"。非字符串 → 空串（缺失）。
 */
export function normalizeOpType(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

export function stripServicePrefix(toolName: string): string {
  const sep = toolName.indexOf('__');
  return sep >= 0 ? toolName.slice(sep + 2) : toolName;
}

export function matchKeys(toolName: string): string[] {
  const full = normalizeName(toolName);
  if (full === '') return [];
  const keys = [full];
  const sep = toolName.indexOf('__');
  if (sep >= 0) {
    const stripped = normalizeName(toolName.slice(sep + 2));
    if (stripped !== '' && stripped !== full) keys.push(stripped);
  }
  return keys;
}

export function ontologySignature(agentDir: string): string {
  return ontologyDirSignature(agentDir);
}

export interface OntologyBehaviorDoc {
  name: string;
  title: string;
  opType: string;
}

export interface OntologyFunctionDoc {
  name: string;
  response: unknown;
  type: string;
}

export interface OntologyDoc {
  key: string;
  scenarioName: string;
  ontologyName: string;
  behaviors: OntologyBehaviorDoc[];
  rules: unknown[];
  functions: OntologyFunctionDoc[];
}

export function parseOntologyDoc(
  raw: Record<string, unknown>,
  warnings: string[],
  key: string,
  source: string = key,
): OntologyDoc {
  const metadata = asRecord(raw.metadata);
  const dirNames = splitKey(key);
  const scenarioName = text(metadata?.scenario_name) ?? dirNames.scenario;
  const ontologyName = text(metadata?.ontology_name) ?? dirNames.ontology;

  const behaviors: OntologyBehaviorDoc[] = [];
  const seen = new Set<string>();
  if (raw.behaviors !== undefined && !Array.isArray(raw.behaviors)) {
    warnings.push(`${source}:behaviors_not_array`);
  }
  for (const item of asArray(raw.behaviors)) {
    const record = asRecord(item);
    const name = text(record?.name);
    if (name === undefined) {
      warnings.push(`${source}:behavior_missing_name`);
      continue;
    }
    const norm = normalizeName(name);
    if (seen.has(norm)) {
      warnings.push(`${source}:behavior_duplicated:${name}`);
      continue;
    }
    seen.add(norm);
    behaviors.push({
      name,
      title: text(record?.title) ?? '',
      opType: text(record?.op_type) ?? '',
    });
  }

  if (raw.rules !== undefined && !Array.isArray(raw.rules)) {
    warnings.push(`${source}:rules_not_array`);
  }

  const functions: OntologyFunctionDoc[] = [];
  if (raw.functions !== undefined && !Array.isArray(raw.functions)) {
    warnings.push(`${source}:functions_not_array`);
  }
  for (const item of asArray(raw.functions)) {
    const record = asRecord(item);
    const name = text(record?.name);
    if (name === undefined) {
      warnings.push(`${source}:function_missing_name`);
      continue;
    }
    if (record?.response === undefined) {
      warnings.push(`${source}:function_missing_response:${name}`);
    }
    functions.push({
      name,
      response: record?.response,
      type: text(record?.type) ?? '',
    });
  }

  return {
    key,
    scenarioName,
    ontologyName,
    behaviors,
    rules: asArray(raw.rules),
    functions,
  };
}

/**
 * 加载一个数字人的全部本体（只读；**永不抛**）。
 *
 * 读不到（文件缺失 / 符号链接 / 坏 YAML / 非对象）的本体**不进入**结果：
 * 调用方据此认定"该本体不参与判定"，与"已识别行为但配置不可用"区分开。
 */
export function loadOntologyDocs(agentDir: string, warnings: string[]): OntologyDoc[] {
  const docs: OntologyDoc[] = [];
  const refs: OntologyDirRef[] = listOntologyDirs(agentDir, warnings, WARNING_LABEL);
  for (const ref of refs) {
    const key = `${ref.scenario}/${ref.ontology}`;
    const file = path.join(ref.dir, ONTOLOGY_FILE);
    const parsed = readYamlObject(file, warnings);
    if (!parsed) continue;
    docs.push(parseOntologyDoc(parsed, warnings, key, file));
  }
  return docs;
}

function splitKey(key: string): { scenario: string; ontology: string } {
  const sep = key.indexOf('/');
  if (sep < 0) return { scenario: key, ontology: key };
  return { scenario: key.slice(0, sep), ontology: key.slice(sep + 1) };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
