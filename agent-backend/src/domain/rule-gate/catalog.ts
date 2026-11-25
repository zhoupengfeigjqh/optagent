/**
 * 规则视图加载（021）：把部署产物解析成**不可变快照**。
 *
 * 数据源唯一：`{agentDir}/ontology/{场景}/{本体}/ontology.yaml` 的 `rules` 段
 * （`FR-010`：不读平台配置、不读其他本体的同名规则）。
 *
 * 失效判据与 020 完全一致：`ontology` 根目录 `mtimeMs`（目录级原子改名会改变它）。
 *
 * 2026-11-24（行为类型收敛）：
 * 1. `behaviors[].op_type` 只接受 `command` / `query`（归一：去空白 + 小写）；
 *    缺失或其它值 → 该行为**非法**（运行期 fatal），不进索引、不装载规则；
 * 2. 多本体同名行为合并：`op_type` 必须**一致**；`query` 与 `command` 混用 → 非法；
 * 3. 被规则绑定、但未在 `behaviors[]` 声明的行为 → 非法（运行期 fatal）；
 * 4. **只有 `command` 装载前置规则**；`query` 的规则静默忽略（query 没有前置规则）。
 *
 * 后置规则本版仍整体移除：`position: 后置` 在任何行为解析**之前**静默跳过，
 * 既不产生运行时效果，也不参与"未声明"判定。
 */
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

/** 目录签名（与 020 共用 `ontology-doc` 的唯一实现） */
export function catalogSignature(agentDir: string): string {
  return ontologySignature(agentDir);
}

/** `behaviors[]` 的一次声明（跨本体聚合后的形态） */
interface DeclaredBehavior {
  ref: BehaviorRef;
  /** 本体键 → 归一 `op_type`（缺失为空串） */
  opTypes: Map<string, string>;
  /** 本体键 → 原始 `op_type`（文案展示用） */
  raw: Map<string, string>;
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
  const invalidBehaviors = new Map<string, InvalidBehavior>();
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

  // 第二遍：三态裁决（合法 command / 合法 query / 非法）
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

  // 第三遍：装载规则（只有 command 保留；query 静默忽略）
  for (const doc of docs) {
    for (const raw of doc.rules) {
      const rule = normalizeRule(raw, doc, warnings);
      if (rule === null) continue;
      // 后置规则：先跳过，绝不参与行为解析（不产生运行时效果，也不会把行为标成非法）
      if (rule.position === '后置') continue;

      const key = normalizeName(rule.behavior);
      // 该行为本身已非法（op_type 坏 / 冲突）：规则不再参与，运行期按 fatal 处理
      if (invalidBehaviors.has(key)) continue;

      const bucket = behaviorIndex.get(key);
      if (bucket === undefined) {
        // 被规则绑定但未在 behaviors[] 声明 → 非法（2026-11-24）
        warnings.push(`${doc.key}:behavior_undeclared:${rule.behavior}`);
        invalidBehaviors.set(key, {
          ref: toRef(doc, rule.behavior),
          reason: 'undeclared',
          sources: [],
        });
        continue;
      }
      // query 没有前置规则：规则静默忽略（用户口径 2026-11-24）
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

/** 声明来源（冲突/非法文案要点名"谁说的"；`op_type` 保留原始值） */
function sourcesOf(entry: DeclaredBehavior): BehaviorOpTypeSource[] {
  return [...entry.opTypes.keys()].map((ontologyKey) => ({
    ontologyKey,
    opType: entry.raw.get(ontologyKey) ?? '',
  }));
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
