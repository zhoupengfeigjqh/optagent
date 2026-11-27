import path from 'node:path';

import { listOntologyDirs, readYamlObject } from '../ontology-files.js';
import type {
  OntologyBehavior,
  OntologyConcept,
  OntologyDefinition,
  OntologyFunction,
  OntologyIndex,
  OntologyRelation,
} from './types.js';

export function loadOntologyIndex(agentDir: string): OntologyIndex {
  const index: OntologyIndex = { byId: new Map(), all: [], warnings: [] };
  for (const ref of listOntologyDirs(agentDir, index.warnings, 'ontology')) {
    const file = path.join(ref.dir, 'ontology.yaml');
    const parsed = loadOntologyFile(file, index.warnings);
    if (!parsed) continue;
    index.all.push(parsed);
    const bucket = index.byId.get(parsed.ontologyId);
    if (bucket) bucket.push(parsed);
    else index.byId.set(parsed.ontologyId, [parsed]);
  }
  return index;
}

function loadOntologyFile(file: string, warnings: string[]): OntologyDefinition | null {
  // 非对象根三类降级与告警口径都在那里，本文件只做字段建模
  const record = readYamlObject(file, warnings);
  if (!record) return null;

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
    functions: parseFunctions(record.functions, warnings, file),
    concepts: parseConcepts(record.concepts, warnings, file),
    relations: parseRelations(record.relations, warnings, file),
  };
}

function parseFunctions(value: unknown, warnings: string[], file: string): OntologyFunction[] {
  const result: OntologyFunction[] = [];
  if (value !== undefined && !Array.isArray(value)) warnings.push(`${file}:functions_not_array`);
  for (const item of asArray(value)) {
    const record = (item ?? {}) as Record<string, unknown>;
    const name = normalizeText(record.name);
    if (!name) {
      warnings.push(`${file}:function_missing_name`);
      continue;
    }
    result.push({
      name,
      title: normalizeText(record.title) ?? name,
      description: normalizeText(record.description) ?? '',
      // 坏形状（非数组 / 混入非字符串）按空数组处理：取数少一条不该让整轮降级
      relatedConcepts: normalizeList(record.related_concepts),
    });
  }
  return result;
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
    const displayName = name === '' ? `${source}->${target}` : name;
    result.push({
      name: displayName,
      source,
      target,
      title: normalizeText(record.title) ?? displayName,
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
