import { matchKeys, normalizeName } from '../ontology-doc.js';
import { catalogSignature, loadGateCatalog } from './catalog.js';
import { evaluateRules } from './evaluate.js';
import { declaredTypeOf } from './field-path.js';
import {
  denyDetails,
  denyMessage,
  fatalDetails,
  fatalMessage,
  pauseDetails,
  pauseMessage,
} from './format.js';
import type {
  BehaviorRuleBucket,
  DenyReason,
  EvaluateContext,
  FailedCondition,
  GateSnapshot,
  InvalidBehavior,
  PrepareInput,
  PrepareResult,
  RuleGateInput,
  RuleGatePort,
  RuleSpec,
} from './types.js';

/** 兜底文案：异常路径没有可靠的 `BehaviorRef`，只给可操作的建议 */
const FALLBACK_MESSAGE = '本体行为未通过规则校验：规则配置不可用，本轮已中止。';
const FALLBACK_DETAILS = [
  '原因：规则配置不可用（规则段或判定设计结构非法、求值过程异常）',
  '建议：检查该本体 ontology.yaml 中该行为的 rules 与 rule_design 结构。',
];

export function createRuleGate(input: RuleGateInput): RuleGatePort {
  let snapshot: GateSnapshot | null = null;
  const warnedUndeclared = new Set<string>();
  const warnedNoDesign = new Set<string>();

  /** 告警出口（日志故障不得影响判定） */
  const report = (warnings: string[]): void => {
    if (warnings.length === 0) return;
    try {
      input.warn?.(warnings.slice(0, 20));
    } catch {
      // 原则九：可观测性不能反向制造故障
    }
  };

  const ensureSnapshot = (): GateSnapshot => {
    const signature = catalogSignature(input.agentDir);
    if (snapshot !== null && snapshot.signature === signature) return snapshot;
    snapshot = loadGateCatalog(input.agentDir, signature);
    report(snapshot.warnings);
    return snapshot;
  };

  const buildContext = (snap: GateSnapshot, record: PrepareInput['record']): EvaluateContext => ({
    resultOf(functionName) {
      if (!record.has(functionName)) return { found: false, value: undefined };
      const value = record.get(functionName);
      if (value === null || value === undefined) return { found: false, value: undefined };
      return { found: true, value };
    },
    declaredTypeOf(functionName, field) {
      const key = normalizeName(functionName);
      if (!snap.functionResponses.has(key)) {
        if (!warnedUndeclared.has(key)) {
          warnedUndeclared.add(key);
          report([`${key}:function_not_declared`]);
        }
        return undefined;
      }
      return declaredTypeOf(snap.functionResponses.get(key), field);
    },
  });

  return {
    prepare(prepareInput: PrepareInput): PrepareResult {
      try {
        const snap = ensureSnapshot();

        //    必须最先判：否则它会掉进下面的 `function` 分支被照常执行并写进记录。
        const invalid = findInvalid(snap, prepareInput.toolName);
        if (invalid !== null) return fatalResult(invalid);

        const bucket = findBucket(snap, prepareInput.toolName);

        if (bucket === null) return { kind: 'function' };

        if (!bucket.command) return { kind: 'behavior' };

        if (bucket.pre.length === 0) return { kind: 'behavior', command: true };

        const absent = collectAbsent(bucket.pre, prepareInput.record);
        if (absent.length > 0) {
          const unregistered = collectUnregistered(absent.map((item) => item.missing), prepareInput.available);
          const affected = absent.map((item) => item.rule);
          if (unregistered.length > 0) {
            return denyResult(bucket.ref, 'unregistered', affected, { unregistered });
          }
          const missing = absent.map((item) => item.missing);
          const stale = absent.map((item) => item.stale);
          return {
            kind: 'pause',
            message: pauseMessage(bucket.ref, affected, missing, stale),
            details: pauseDetails(bucket.ref, affected, missing, stale),
            diagnosis: {
              ontologyKey: bucket.ref.ontologyKey,
              behaviorName: bucket.ref.behaviorName,
              rules: affected.map((rule) => rule.name),
              ...optionalList('missingFunctions', uniqueOf(missing)),
              ...optionalList('staleFunctions', uniqueOf(stale)),
            },
          };
        }

        for (const rule of bucket.pre) {
          if (rule.design !== null || rule.designInvalid === true) continue;
          const key = `${rule.behavior}:${rule.name}`;
          if (warnedNoDesign.has(key)) continue;
          warnedNoDesign.add(key);
          report([`${key}:rule_without_design`]);
        }

        const invalidDesign = bucket.pre.find((rule) => rule.designInvalid === true);
        if (invalidDesign !== undefined) {
          return denyResult(bucket.ref, 'config_unavailable', [invalidDesign], {});
        }

        const outcome = evaluateRules(bucket.pre, buildContext(snap, prepareInput.record));
        if (!outcome.passed) {
          const failedRules = rulesOf(outcome.failed, bucket.pre);
          return denyResult(bucket.ref, 'condition_false', failedRules, {
            failed: outcome.failed,
          });
        }

        return { kind: 'behavior', command: true };
      } catch {
        return {
          kind: 'deny',
          message: FALLBACK_MESSAGE,
          details: FALLBACK_DETAILS,
          reason: 'config_unavailable',
        };
      }
    },

    invalidate(): void {
      snapshot = null;
      warnedUndeclared.clear();
      warnedNoDesign.clear();
    },
    lookupBehavior(toolName) {
      const snap = ensureSnapshot();
      const bucket = findBucket(snap, toolName);
      if (bucket === null) return null;
      const relatedFunctions: string[] = [];
      for (const rule of bucket.pre) {
        for (const fn of rule.relatedFunctions) {
          if (!relatedFunctions.includes(fn)) relatedFunctions.push(fn);
        }
      }
      return { toolName, command: bucket.command, relatedFunctions, ref: bucket.ref };
    },
  };
}

function findInvalid(snap: GateSnapshot, toolName: string): InvalidBehavior | null {
  for (const key of matchKeys(toolName)) {
    const invalid = snap.invalidBehaviors.get(key);
    if (invalid !== undefined) return invalid;
  }
  return null;
}

function findBucket(snap: GateSnapshot, toolName: string): BehaviorRuleBucket | null {
  for (const key of matchKeys(toolName)) {
    const bucket = snap.behaviorIndex.get(key);
    if (bucket !== undefined) return bucket;
  }
  return null;
}

interface AbsentFunctions {
  rule: RuleSpec;
  missing: string[];
  stale: string[];
}

/** 每条规则各自不可用的函数，按"没算"与"过期"分桶（`related_functions` 为空则永不缺） */
function collectAbsent(rules: RuleSpec[], record: PrepareInput['record']): AbsentFunctions[] {
  const absent: AbsentFunctions[] = [];
  for (const rule of rules) {
    const missing: string[] = [];
    const stale: string[] = [];
    for (const fn of rule.relatedFunctions) {
      if (record.has(fn)) continue;
      if (record.hasEver(fn)) stale.push(fn);
      else missing.push(fn);
    }
    if (missing.length > 0 || stale.length > 0) absent.push({ rule, missing, stale });
  }
  return absent;
}

function collectUnregistered(
  missing: ReadonlyArray<readonly string[]>,
  available: ReadonlySet<string>,
): string[] {
  const all = new Set<string>();
  for (const functions of missing) {
    for (const fn of functions) all.add(fn);
  }
  return [...all].filter((fn) => !available.has(normalizeName(fn)));
}

function uniqueOf(groups: ReadonlyArray<readonly string[]>): string[] {
  const all = new Set<string>();
  for (const functions of groups) {
    for (const fn of functions) all.add(fn);
  }
  return [...all];
}

function optionalList(
  key: 'missingFunctions' | 'staleFunctions',
  values: string[],
): Record<string, string[]> {
  return values.length > 0 ? { [key]: values } : {};
}

function fatalResult(invalid: InvalidBehavior): PrepareResult {
  return {
    kind: 'fatal',
    message: fatalMessage(invalid),
    details: fatalDetails(invalid),
    reason: 'config_unavailable',
    cause: invalid.reason,
    diagnosis: {
      ontologyKey: invalid.ref.ontologyKey,
      behaviorName: invalid.ref.behaviorName,
      rules: [],
    },
  };
}

function denyResult(
  ref: BehaviorRuleBucket['ref'],
  reason: DenyReason,
  rules: RuleSpec[],
  extra: { unregistered?: string[]; failed?: FailedCondition[] },
): PrepareResult {
  return {
    kind: 'deny',
    message: denyMessage(ref, reason),
    details: denyDetails({
      ref,
      reason,
      rules,
      ...(extra.unregistered !== undefined ? { unregistered: extra.unregistered } : {}),
      ...(extra.failed !== undefined ? { failed: extra.failed } : {}),
    }),
    reason,
    diagnosis: {
      ontologyKey: ref.ontologyKey,
      behaviorName: ref.behaviorName,
      rules: rules.map((rule) => rule.name),
      ...(extra.unregistered !== undefined
        ? { unregisteredFunctions: extra.unregistered }
        : {}),
      ...(extra.failed !== undefined ? { failedConditions: extra.failed } : {}),
    },
  };
}

function rulesOf(failed: Array<{ rule: string }>, rules: RuleSpec[]): RuleSpec[] {
  const names = new Set(failed.map((item) => item.rule));
  const matched = rules.filter((rule) => names.has(rule.name));
  return matched.length > 0 ? matched : rules;
}
