import { loadOntologyDocs, normalizeName, normalizeOpType, ontologySignature, type OntologyDoc } from '../ontology-doc.js';
import { normalizeDesign } from './design.js';
import type {
  BehaviorOpTypeSource,
  BehaviorRef,
  BehaviorRuleBucket,
  GateSnapshot,
  InvalidBehavior,
  RulePosition,
  RuleSpec,
} from './types.js';

export function catalogSignature(agentDir: string): string {
  return ontologySignature(agentDir);
}

interface DeclaredBehavior {
  ref: BehaviorRef;
  opTypes: Map<string, string>;
  raw: Map<string, string>;
}

export function loadGateCatalog(agentDir: string, signature?: string): GateSnapshot {
  const warnings: string[] = [];
  const behaviorIndex = new Map<string, BehaviorRuleBucket>();
  const invalidBehaviors = new Map<string, InvalidBehavior>();
  const functionResponses = new Map<string, unknown>();

  const docs = loadOntologyDocs(agentDir, warnings);

  for (const doc of docs) {
    for (const fn of doc.functions) {
      const key = normalizeName(fn.name);
      if (key === '') continue;
      if (functionResponses.has(key)) {
        warnings.push(`${doc.key}:function_duplicated:${fn.name}`);
        continue;
      }
      functionResponses.set(key, fn.response);
    }
  }

  // 第一遍：跨本体聚合行为声明（必须全部收齐才能裁决 op_type 冲突）
  const declared = new Map<string, DeclaredBehavior>();
  for (const doc of docs) {
    for (const behavior of doc.behaviors) {
      const key = normalizeName(behavior.name);
      if (key === '') continue;
      const entry = declared.get(key) ?? {
        ref: toRef(doc, behavior.name),
        opTypes: new Map<string, string>(),
        raw: new Map<string, string>(),
      };
      entry.opTypes.set(doc.key, normalizeOpType(behavior.opType));
      entry.raw.set(doc.key, behavior.opType);
      declared.set(key, entry);
    }
  }

  for (const [key, entry] of declared) {
    const opTypes = [...entry.opTypes.values()];
    const bad = opTypes.find((value) => value !== 'command' && value !== 'query');
    if (bad !== undefined) {
      warnings.push(`${entry.ref.ontologyKey}:behavior_bad_op_type:${entry.ref.behaviorName}`);
      invalidBehaviors.set(key, {
        ref: entry.ref,
        reason: 'bad_op_type',
        sources: sourcesOf(entry),
      });
      continue;
    }
    if (new Set(opTypes).size > 1) {
      warnings.push(`${entry.ref.ontologyKey}:behavior_op_type_conflict:${entry.ref.behaviorName}`);
      invalidBehaviors.set(key, {
        ref: entry.ref,
        reason: 'op_type_conflict',
        sources: sourcesOf(entry),
      });
      continue;
    }
    behaviorIndex.set(key, {
      ref: entry.ref,
      command: opTypes[0] === 'command',
      pre: [],
    });
  }

  for (const doc of docs) {
    for (const raw of doc.rules) {
      const rule = normalizeRule(raw, doc, warnings);
      if (rule === null) continue;
      if (rule.position === '后置') continue;

      const key = normalizeName(rule.behavior);
      if (invalidBehaviors.has(key)) continue;

      const bucket = behaviorIndex.get(key);
      if (bucket === undefined) {
        warnings.push(`${doc.key}:behavior_undeclared:${rule.behavior}`);
        invalidBehaviors.set(key, {
          ref: toRef(doc, rule.behavior),
          reason: 'undeclared',
          sources: [],
        });
        continue;
      }
      if (!bucket.command) continue;
      bucket.pre.push(rule);
    }
  }

  return {
    signature: signature ?? catalogSignature(agentDir),
    behaviorIndex,
    invalidBehaviors,
    functionResponses,
    warnings,
  };
}

function toRef(doc: OntologyDoc, behaviorName: string): BehaviorRef {
  return {
    ontologyKey: doc.key,
    scenarioName: doc.scenarioName,
    ontologyName: doc.ontologyName,
    behaviorName,
  };
}

function sourcesOf(entry: DeclaredBehavior): BehaviorOpTypeSource[] {
  return [...entry.opTypes.keys()].map((ontologyKey) => ({
    ontologyKey,
    opType: entry.raw.get(ontologyKey) ?? '',
  }));
}

function normalizeRule(raw: unknown, doc: OntologyDoc, warnings: string[]): RuleSpec | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push(`${doc.key}:rule_not_object`);
    return null;
  }

  const behavior = text(record.behavior);
  if (behavior === undefined) {
    warnings.push(`${doc.key}:rule_missing_behavior`);
    return null;
  }

  const position = asPosition(record.position);
  if (position === undefined) {
    warnings.push(`${doc.key}:rule_bad_position:${String(record.position)}`);
    return null;
  }

  const relatedFunctions: string[] = [];
  if (record.related_functions !== undefined && !Array.isArray(record.related_functions)) {
    warnings.push(`${doc.key}:related_functions_not_array:${behavior}`);
  }
  for (const item of asArray(record.related_functions)) {
    if (typeof item !== 'string' || item.trim() === '') {
      warnings.push(`${doc.key}:related_function_ignored:${behavior}`);
      continue;
    }
    relatedFunctions.push(item.trim());
  }

  const dataSupplements: string[] = [];
  if (record.data_supplements !== undefined && !Array.isArray(record.data_supplements)) {
    warnings.push(`${doc.key}:data_supplements_not_array:${behavior}`);
  }
  for (const item of asArray(record.data_supplements)) {
    if (typeof item !== 'string') continue;
    dataSupplements.push(item);
  }

  let design = null as RuleSpec['design'];
  let designInvalid = false;
  if (record.rule_design !== undefined && record.rule_design !== null) {
    design = normalizeDesign(record.rule_design, warnings);
    if (design === null && asRecord(record.rule_design) === null) designInvalid = true;
  }

  const passMessage = text(record.pass_message) ?? design?.passMessage ?? '';
  const failMessage = text(record.fail_message) ?? design?.failMessage ?? '';

  const rule: RuleSpec = {
    name: text(record.name) ?? '',
    title: text(record.title) ?? '',
    description: text(record.description) ?? '',
    behavior,
    position,
    relatedFunctions,
    dataSupplements,
    design,
    passMessage,
    failMessage,
    raw: record,
  };
  if (designInvalid) rule.designInvalid = true;
  return rule;
}

function asPosition(value: unknown): RulePosition | undefined {
  return value === '前置' || value === '后置' ? value : undefined;
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
