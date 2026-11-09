/**
 * 规则视图加载（021）：把部署产物解析成**不可变快照**。
 *
 * 数据源唯一：`{agentDir}/ontology/{场景}/{本体}/ontology.yaml` 的 `rules` 段
 * （`FR-010`：不读平台配置、不读其他本体的同名规则）。
 *
 * 失效判据与 020 完全一致：`ontology` 根目录 `mtimeMs`（目录级原子改名会改变它）。
 */
import { loadOntologyDocs, normalizeName, ontologySignature, type OntologyDoc } from '../ontology-doc.js';
import { normalizeDesign } from './design.js';
import type {
  BehaviorRuleBucket,
  GateSnapshot,
  RulePosition,
  RuleSpec,
} from './types.js';

/** 目录签名（与 020 共用 `ontology-doc` 的唯一实现） */
export function catalogSignature(agentDir: string): string {
  return ontologySignature(agentDir);
}

/**
 * 加载一次完整快照（**永不抛**）。
 *
 * @param agentDir 数字人配置目录
 * @param signature 目录签名（调用方已算好可传进来，省一次 `stat`）
 */
export function loadGateCatalog(agentDir: string, signature?: string): GateSnapshot {
  const warnings: string[] = [];
  const behaviorIndex = new Map<string, BehaviorRuleBucket>();
  const functionResponses = new Map<string, unknown>();

  const docs = loadOntologyDocs(agentDir, warnings);

  // 函数声明（只用于取字段类型；同名以先出现者为准，冲突记告警）
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

  // 行为索引：先登记 `behaviors[]`（空桶 = "是本体行为但没有规则"）。
  // 这一步不能省：没有规则的行为也要被识别，否则它会被当成"函数"写进记录（`FR-002`）。
  for (const doc of docs) {
    for (const behavior of doc.behaviors) {
      const key = normalizeName(behavior.name);
      if (key === '' || behaviorIndex.has(key)) continue;
      behaviorIndex.set(key, {
        ref: {
          ontologyKey: doc.key,
          scenarioName: doc.scenarioName,
          ontologyName: doc.ontologyName,
          behaviorName: behavior.name,
        },
        pre: [],
        post: [],
      });
    }
  }

  for (const doc of docs) {
    for (const raw of doc.rules) {
      const rule = normalizeRule(raw, doc, warnings);
      if (rule === null) continue;
      const behaviorKey = normalizeName(rule.behavior);
      let bucket = behaviorIndex.get(behaviorKey);
      if (bucket === undefined) {
        // 规则绑定了 `behaviors[]` 未声明的行为：仍按行为入口登记（规则即声明）
        bucket = {
          ref: {
            ontologyKey: doc.key,
            scenarioName: doc.scenarioName,
            ontologyName: doc.ontologyName,
            behaviorName: rule.behavior,
          },
          pre: [],
          post: [],
        };
        behaviorIndex.set(behaviorKey, bucket);
      }
      if (rule.position === '前置') bucket.pre.push(rule);
      else bucket.post.push(rule);
    }
  }

  return {
    signature: signature ?? catalogSignature(agentDir),
    behaviorIndex,
    functionResponses,
    warnings,
  };
}

/** 单条规则归一：`behavior` 空或 `position` 非"前置/后置"→ 整条忽略 + 告警 */
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

  // `rule_design` 缺失/为空 → null（视为未设计，不阻断）；
  // 存在但不是对象 → `designInvalid`（fail-closed，`FR-025`）。
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
