import path from 'node:path';

import { normalizeName, ontologySignature, parseOntologyDoc } from '../ontology-doc.js';
import { listOntologyDirs, readYamlObject } from '../ontology-files.js';
import type {
  BehaviorBinding,
  GuardSnapshot,
  OntologyEntry,
  OntologyStatus,
  SecurityEntry,
} from './types.js';

/** 目录不可读等底层告警的前缀（与意图聚焦的 `ontology` 标签区分） */
const WARNING_LABEL = 'scope_guard';
const SECURITIES_FILE = 'securities.yaml';

export const catalogSignature: (agentDir: string) => string = ontologySignature;

export function loadGuardCatalog(agentDir: string, signature?: string): GuardSnapshot {
  const warnings: string[] = [];
  const byBehavior = new Map<string, BehaviorBinding[]>();
  const ontologies = new Map<string, OntologyEntry>();

  for (const ref of listOntologyDirs(agentDir, warnings, WARNING_LABEL)) {
    const key = `${ref.scenario}/${ref.ontology}`;
    const ontologyFile = path.join(ref.dir, 'ontology.yaml');
    const parsed = readYamlObject(ontologyFile, warnings);
    // （工具按非本体行为放行；与"已识别行为但管控不可用→拒绝"是两种情形）
    if (!parsed) continue;

    const doc = parseOntologyDoc(parsed, warnings, key, ontologyFile);
    const { scenarioName, ontologyName } = doc;
    const behaviors: BehaviorBinding[] = doc.behaviors.map((behavior) => ({
      behaviorName: behavior.name,
      ontologyKey: key,
    }));

    const securitiesFile = path.join(ref.dir, SECURITIES_FILE);
    const warningsBefore = warnings.length;
    const securities = readYamlObject(securitiesFile, warnings);
    const entries = new Map<string, SecurityEntry>();
    let status: OntologyStatus = 'ok';

    if (!securities) {
      // 文件不存在 / 符号链接 / 坏 YAML：该本体的行为一律"管控配置不可用"
      status = 'no_securities';
      if (warnings.length === warningsBefore) warnings.push(`${securitiesFile}:missing`);
    } else if (!Array.isArray(securities.securities)) {
      warnings.push(`${securitiesFile}:securities_not_array`);
      status = 'no_securities';
    } else {
      for (const item of securities.securities) {
        const record = asRecord(item);
        const actionName = text(record?.action_name);
        if (actionName === undefined) {
          warnings.push(`${securitiesFile}:security_missing_action_name`);
          continue;
        }
        const norm = normalizeName(actionName);
        if (entries.has(norm)) {
          warnings.push(`${securitiesFile}:security_duplicated:${actionName}`);
          continue;
        }
        const rawScope = record?.scope;
        if (rawScope !== undefined && !Array.isArray(rawScope)) {
          warnings.push(`${securitiesFile}:scope_not_array:${actionName}`);
        }
        const normalized = normalizeScope(rawScope);
        if (normalized.ignored > 0) {
          warnings.push(`${securitiesFile}:scope_ignored_elements:${actionName}:${normalized.ignored}`);
        }
        entries.set(norm, {
          actionName,
          scope: normalized.scope,
          ignored: normalized.ignored,
        });
      }
    }

    const entry: OntologyEntry = {
      key,
      scenarioName,
      ontologyName,
      status,
      behaviors,
      entries,
    };
    ontologies.set(key, entry);

    for (const binding of behaviors) {
      const bucket = byBehavior.get(normalizeName(binding.behaviorName));
      if (bucket) bucket.push(binding);
      else byBehavior.set(normalizeName(binding.behaviorName), [binding]);
    }
  }

  // 同名行为跨本体时，判定顺序必须可复现（拒绝优先取"稳定顺序第一条"）
  for (const bucket of byBehavior.values()) {
    bucket.sort((a, b) => (a.ontologyKey < b.ontologyKey ? -1 : a.ontologyKey > b.ontologyKey ? 1 : 0));
  }

  return {
    signature: signature ?? catalogSignature(agentDir),
    byBehavior,
    ontologies,
    warnings,
  };
}

function normalizeScope(value: unknown): { scope: string[]; ignored: number } {
  if (!Array.isArray(value)) return { scope: [], ignored: 0 };
  const scope: string[] = [];
  let ignored = 0;
  for (const item of value) {
    if (typeof item !== 'string') {
      ignored += 1;
      continue;
    }
    const norm = normalizeName(item);
    if (norm === '') {
      ignored += 1;
      continue;
    }
    if (!scope.includes(norm)) scope.push(norm);
  }
  return { scope, ignored };
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
