/**
 * `ontology.yaml` 的**唯一**解析与名称归一入口（020 权限闸门与 021 规则闸门共用）。
 *
 * 为什么单独抽一层：行为识别的口径（"这个工具是不是某个已部署本体的行为"）是
 * **安全相关**的，权限闸门与规则闸门各写一套必然漂移——规则闸门会在一处认为
 * "是行为"、权限闸门在另一处认为"不是"，从而出现绕过。因此口径收敛到这里
 * （宪章原则二：同一规则唯一来源）。
 *
 * 三条口径：
 * 1. **只读、不判断**：本文件只做"解析成结构 + 归一名称"，不含授权/规则判定；
 * 2. **坏数据不中断**：结构非法只记 warning（片段与 020 既有口径逐字一致）；
 * 3. **不直连文件系统**：枚举与读取经 `ontology-files.ts`（拒绝符号链接、坏 YAML 降级）。
 */
import path from 'node:path';

import {
  listOntologyDirs,
  ontologyDirSignature,
  readYamlObject,
  type OntologyDirRef,
} from './ontology-files.js';

/** `ontology.yaml` 文件名（与 `securities.yaml` 区分，避免写成常量表） */
const ONTOLOGY_FILE = 'ontology.yaml';

/** 枚举本体内文件的告警标签（020 既有口径） */
const WARNING_LABEL = 'ontology';

/** 名称归一化：去首尾空白 + 小写（大小写不敏感，漏拦代价高于误拦） */
export function normalizeName(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 去掉首个 `__` 前缀（保留原大小写与首尾空白，仅用于展示/记录键）。
 *
 * MCP 工具名现状是 `{服务名}__{工具名}`；本体 `related_functions` 写的是裸名。
 */
export function stripServicePrefix(toolName: string): string {
  const sep = toolName.indexOf('__');
  return sep >= 0 ? toolName.slice(sep + 2) : toolName;
}

/**
 * 工具名 → 候选匹配键（1~2 个）：完整名与去首个 `__` 前缀后的名字。
 *
 * 装配层给 MCP 工具加了 `{服务名}__` 前缀，但"工具名本身就是行为名"的服务同样存在，
 * 只试一种会产生无解释的漏拦。
 */
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

/** 目录签名（020 与 021 共用同一实现；缺失为 `missing`） */
export function ontologySignature(agentDir: string): string {
  return ontologyDirSignature(agentDir);
}

/** 一个本体目录解析出的行为声明 */
export interface OntologyBehaviorDoc {
  /** 行为名（`behaviors[].name` 原文） */
  name: string;
  /** 展示标题（缺省空串） */
  title: string;
  /** `query` / `command`（缺省空串） */
  opType: string;
}

/** 一个本体目录解析出的函数声明（本特性只用它取字段类型） */
export interface OntologyFunctionDoc {
  /** 函数名（`functions[].name` 原文） */
  name: string;
  /** `response` 声明（缺失为 `undefined`，字段类型按未声明处理） */
  response: unknown;
  /** `query` / `command`（缺省空串） */
  type: string;
}

/** 一份本体的只读视图 */
export interface OntologyDoc {
  /** `{场景目录}/{本体目录}` */
  key: string;
  /** `metadata.scenario_name`，回退场景目录名 */
  scenarioName: string;
  /** `metadata.ontology_name`，回退本体目录名 */
  ontologyName: string;
  behaviors: OntologyBehaviorDoc[];
  /** `rules[]` 原样保留（归一与判定由调用方负责） */
  rules: unknown[];
  functions: OntologyFunctionDoc[];
}

/**
 * 解析一份已读出的 `ontology.yaml`（**永不抛**）。
 *
 * @param raw 解析后的对象
 * @param warnings 告警出口（片段形如 `<source>:behavior_missing_name`，与 020 既有口径一致）
 * @param key `{场景}/{本体}`，作为快照索引键
 * @param source 告警前缀（通常是 `ontology.yaml` 的绝对路径）；缺省用 `key`
 */
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

/** `{场景}/{本体}` → 两段目录名（用首个 `/` 切分，允许名称内有 `/`） */
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
