/**
 * 规则闸门的判定合成层：缓存 + 签名重载 + 五种结局。
 *
 * 三条硬约束：
 * 1. **永不抛**：任何异常都收敛成 `deny(config_unavailable)`（fail-closed）；
 * 2. **零副作用**：除缓存与 `warn` 出口，不写文件、不发请求；
 * 3. **不依赖环境**：不知道工具从哪来、不知道 MCP / HITL / HTTP，也不 import `infra`。
 *
 * 判定顺序（`FR-013`，不可调换）：
 * `非法行为(fatal) → 识别 → 非行为(function) → query(直接执行) → 无前置规则
 *  → 缺函数 → 注册校验 → 暂停 → 求值 → 拒绝/放行`。
 *
 * 2026-11-24：
 * - 非法行为（`op_type` 非法 / 同名冲突 / 未声明却被规则绑定）**先于**"不是本体行为"
 *   判定——否则它会落到 `function` 分支被照常执行，配置错误变成静默放行；
 * - `query` 不判规则、不求值；只有 `command` 走完整闸门；
 * - 暂停区分"从未执行"与"已过期（上一次 command 之前算的）"。
 */
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

/** 创建闸门（惰性加载；目录签名变化时自动重载） */
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

  /** 求值上下文：`null` 与"键不存在"都视为取不到值（`FR-021`） */
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

        // 0. 非法本体行为（op_type 坏 / 同名冲突 / 未声明却被规则绑定）→ fatal
        //    必须最先判：否则它会掉进下面的 `function` 分支被照常执行并写进记录。
        const invalid = findInvalid(snap, prepareInput.toolName);
        if (invalid !== null) return fatalResult(invalid);

        const bucket = findBucket(snap, prepareInput.toolName);

        // 1. 不是任何已部署本体的行为 → 按"函数"记录后执行
        if (bucket === null) return { kind: 'function' };

        // 2. query：不判规则、不求值（2026-11-24 口径），也不写记录
        if (!bucket.command) return { kind: 'behavior' };

        // 3. 是命令但没有前置规则 → 直接执行（执行后仍会失效既有函数结果）
        if (bucket.pre.length === 0) return { kind: 'behavior', command: true };

        // 4. 缺函数检查（拆成"从未执行"与"已过期"两桶；值 `null` 不算缺）
        const absent = collectAbsent(bucket.pre, prepareInput.record);
        if (absent.length > 0) {
          // 5. 注册校验**先于**暂停：不存在的函数不该让模型空转补调。
          //    只校验"从未执行"的那些——已过期函数必然注册过。
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

        // 6. `rule_design` 缺失：不阻断，但要留痕（`FR-022`，每条只告警一次）
        for (const rule of bucket.pre) {
          if (rule.design !== null || rule.designInvalid === true) continue;
          const key = `${rule.behavior}:${rule.name}`;
          if (warnedNoDesign.has(key)) continue;
          warnedNoDesign.add(key);
          report([`${key}:rule_without_design`]);
        }

        // 7. 结构非法（rule_design 存在但不是对象）→ fail-closed，先于求值
        const invalidDesign = bucket.pre.find((rule) => rule.designInvalid === true);
        if (invalidDesign !== undefined) {
          return denyResult(bucket.ref, 'config_unavailable', [invalidDesign], {});
        }

        // 8. 求值（不短路，失败条件带出）
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
  };
}

/** 归一名查非法行为（`matchKeys` 同时给完整名与去前缀名） */
function findInvalid(snap: GateSnapshot, toolName: string): InvalidBehavior | null {
  for (const key of matchKeys(toolName)) {
    const invalid = snap.invalidBehaviors.get(key);
    if (invalid !== undefined) return invalid;
  }
  return null;
}

/** 归一行为名查桶（`matchKeys` 同时给完整名与去前缀名） */
function findBucket(snap: GateSnapshot, toolName: string): BehaviorRuleBucket | null {
  for (const key of matchKeys(toolName)) {
    const bucket = snap.behaviorIndex.get(key);
    if (bucket !== undefined) return bucket;
  }
  return null;
}

interface AbsentFunctions {
  rule: RuleSpec;
  /** 本世代从未执行过 */
  missing: string[];
  /** 执行过，但结果产生于上一次 command 之前 */
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

/** 缺失函数里有谁**未注册**（判据只有 `available` 集合，`FR-043`） */
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

/** 空数组不写字段（保持既有诊断字段"缺省即省略"的口径） */
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

/** 由失败条件反查涉及的规则（保持文件内顺序） */
function rulesOf(failed: Array<{ rule: string }>, rules: RuleSpec[]): RuleSpec[] {
  const names = new Set(failed.map((item) => item.rule));
  const matched = rules.filter((rule) => names.has(rule.name));
  return matched.length > 0 ? matched : rules;
}
