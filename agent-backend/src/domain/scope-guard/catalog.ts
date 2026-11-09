/**
 * 判定视图加载（020）：把部署产物解析成**不可变快照**。
 *
 * 数据源只有两处，均为只读：`ontology/{场景}/{本体}/ontology.yaml` 与
 * 同目录 `securities.yaml`（`FR-020`：不读平台配置、无第二套白名单）。
 *
 * 失效判据：`ontology` 根目录的 `mtimeMs`（单次 `stat`）。为什么不复用配置指纹？
 * 因为 `computeConfigFingerprint` 只覆盖 SOUL/TOOL/MCP/scenario 与 skills，
 * **不含 `ontology/**`**；只换本体的部署不会换代，靠指纹会静默用旧策略。
 */
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

/**
 * 目录签名：`ontology` 根目录 mtimeMs；不存在为 `missing`（不告警，属常态）。
 *
 * 实现已下沉到 `ontology-doc.ts`（与 021 规则闸门共用同一口径）；
 * 这里保留同名导出，既有调用方与测试无需改动。
 */
export const catalogSignature: (agentDir: string) => string = ontologySignature;

/**
 * 加载一次完整快照。
 *
 * @param agentDir 数字人配置目录
 * @param signature 目录签名（调用方已算好可传进来，省一次 `stat`）
 */
export function loadGuardCatalog(agentDir: string, signature?: string): GuardSnapshot {
  const warnings: string[] = [];
  const byBehavior = new Map<string, BehaviorBinding[]>();
  const ontologies = new Map<string, OntologyEntry>();

  for (const ref of listOntologyDirs(agentDir, warnings, WARNING_LABEL)) {
    const key = `${ref.scenario}/${ref.ontology}`;
    const ontologyFile = path.join(ref.dir, 'ontology.yaml');
    const parsed = readYamlObject(ontologyFile, warnings);
    // 读不到行为清单 ⇒ 无法认定"这是不是本体行为"，该本体不参与判定
    // （工具按非本体行为放行；与"已识别行为但管控不可用→拒绝"是两种情形）
    if (!parsed) continue;

    // 行为解析与名称归一只有一处实现（`ontology-doc.ts`）：告警片段逐字不变，
    // 因此既有的 `scope-guard-catalog.spec.ts` 是本次重构的零回归门槛。
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

/** `scope` 归一化：只留非空字符串，其余计入 `ignored` */
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
