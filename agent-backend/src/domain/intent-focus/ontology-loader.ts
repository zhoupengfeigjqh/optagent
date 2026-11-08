/**
 * 本体文件加载（016 / 019）：枚举已物化的 `ontology/{场景}/{本体}/ontology.yaml`，
 * 提取 `metadata` / `behaviors` / `concepts` / `relations`，按 `ontology_id` 建索引。
 *
 * 2026-11-06：`functions` 与 `rules` 不再读取（能力聚焦只到行为）。
 * 2026-11-08（019）：新增 `concepts` 与 `relations` 的**只读**建模，供一阶发散使用；
 * 参数正文、函数代码、`rules` 仍然不进来。
 *
 * 三条约束：
 * 1. **只读真实文件**：目录与文件都过 `lstat`，符号链接一律跳过（FR/TR：禁止逃逸）；
 * 2. **坏文件不中断**：解析失败只记 warning，其他本体照常——一个坏文件不该让整轮失效；
 * 3. **只建模发散所需字段**：`concepts` 只取 name/title，`relations` 只取
 *    name/source/target/relation_type/cardinality；方向判定不在本层做（见 `expansion.ts`）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  OntologyBehavior,
  OntologyConcept,
  OntologyDefinition,
  OntologyIndex,
  OntologyRelation,
} from './types.js';

/** 枚举入口：`{agentDir}/ontology` */
export function loadOntologyIndex(agentDir: string): OntologyIndex {
  const index: OntologyIndex = { byId: new Map(), all: [], warnings: [] };
  const root = path.join(agentDir, 'ontology');
  for (const scenario of safeReadDirs(root, index.warnings, 'ontology')) {
    const scenarioDir = path.join(root, scenario);
    for (const ontology of safeReadDirs(scenarioDir, index.warnings, `ontology/${scenario}`)) {
      const file = path.join(scenarioDir, ontology, 'ontology.yaml');
      const parsed = loadOntologyFile(file, index.warnings);
      if (!parsed) continue;
      index.all.push(parsed);
      const bucket = index.byId.get(parsed.ontologyId);
      if (bucket) bucket.push(parsed);
      else index.byId.set(parsed.ontologyId, [parsed]);
    }
  }
  return index;
}

/** 解析单个 ontology.yaml；失败返回 null 并写 warning（内部实现，无需对模块外暴露） */
function loadOntologyFile(file: string, warnings: string[]): OntologyDefinition | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch {
    return null;
  }
  // 符号链接文件同样拒绝：物化产物应是普通文件
  if (!stat.isFile() || stat.isSymbolicLink()) {
    warnings.push(`${file}:not_regular_file`);
    return null;
  }

  let data: unknown;
  try {
    data = parseYaml(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    warnings.push(`${file}:invalid_yaml:${(err as Error).message}`);
    return null;
  }
  if (typeof data !== 'object' || data === null) {
    warnings.push(`${file}:not_object`);
    return null;
  }

  const record = data as Record<string, unknown>;
  const metadata =
    typeof record.metadata === 'object' && record.metadata !== null
      ? (record.metadata as Record<string, unknown>)
      : {};
  const ontologyId = normalizeId(metadata.ontology_id);
  if (!ontologyId) {
    warnings.push(`${file}:missing_ontology_id`);
    return null;
  }

  return {
    filePath: file,
    ontologyId,
    ontologyName: normalizeText(metadata.ontology_name),
    scenarioId: normalizeId(metadata.scenario_id),
    scenarioName: normalizeText(metadata.scenario_name),
    behaviors: parseBehaviors(record.behaviors, warnings, file),
    concepts: parseConcepts(record.concepts, warnings, file),
    relations: parseRelations(record.relations, warnings, file),
  };
}

function parseBehaviors(value: unknown, warnings: string[], file: string): OntologyBehavior[] {
  const result: OntologyBehavior[] = [];
  if (value !== undefined && !Array.isArray(value)) warnings.push(`${file}:behaviors_not_array`);
  for (const item of asArray(value)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = normalizeText(record.name);
    if (!name) {
      warnings.push(`${file}:behavior_missing_name`);
      continue;
    }
    result.push({
      name,
      title: normalizeText(record.title) ?? name,
      description: normalizeText(record.description) ?? '',
      opType: normalizeText(record.op_type),
      // 019：发散入口；缺失照常参与判定，只是这条行为不参与发散
      concept: normalizeText(record.concept),
    });
  }
  return result;
}

/** 概念：只取 name/title（title 缺失以 name 兜底，展示不留空） */
function parseConcepts(value: unknown, warnings: string[], file: string): OntologyConcept[] {
  const result: OntologyConcept[] = [];
  if (value !== undefined && !Array.isArray(value)) warnings.push(`${file}:concepts_not_array`);
  for (const item of asArray(value)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = normalizeText(record.name);
    if (!name) {
      warnings.push(`${file}:concept_missing_name`);
      continue;
    }
    result.push({ name, title: normalizeText(record.title) ?? name });
  }
  return result;
}

/** 关系：`source` / `target` 缺失即整条丢弃（没有端点的边无法参与发散） */
function parseRelations(value: unknown, warnings: string[], file: string): OntologyRelation[] {
  const result: OntologyRelation[] = [];
  if (value !== undefined && !Array.isArray(value)) warnings.push(`${file}:relations_not_array`);
  for (const item of asArray(value)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = normalizeText(record.name) ?? '';
    const source = normalizeText(record.source);
    const target = normalizeText(record.target);
    if (!source || !target) {
      warnings.push(`${file}:relation_missing_endpoint:${name || '?'}`);
      continue;
    }
    result.push({
      name: name === '' ? `${source}->${target}` : name,
      source,
      target,
      // `relation_type` 允许写成单值字符串或数组，统一成数组
      relationType: normalizeList(record.relation_type),
      cardinality: normalizeId(record.cardinality),
    });
  }
  return result;
}

function normalizeList(value: unknown): string[] {
  if (typeof value === 'string') {
    const text = value.trim();
    return text === '' ? [] : [text];
  }
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = normalizeText(item);
    if (text) out.push(text);
  }
  return out;
}

/** 读子目录名（只保留真实目录；不存在返回空数组，不记 warning） */
function safeReadDirs(dir: string, warnings: string[], label: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`${label}:unreadable:${(err as Error).message}`);
    }
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}
