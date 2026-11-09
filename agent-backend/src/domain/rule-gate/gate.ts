/**
 * 规则闸门的判定合成层：缓存 + 签名重载 + 四种结局 + 后置三态。
 *
 * 三条硬约束：
 * 1. **永不抛**：任何异常都收敛成 `deny(config_unavailable)`（fail-closed）；
 * 2. **零副作用**：除缓存与 `warn` 出口，不写文件、不发请求；
 * 3. **不依赖环境**：不知道工具从哪来、不知道 MCP / HITL / HTTP，也不 import `infra`。
 *
 * 判定顺序（`FR-013`，不可调换）：
 * `识别 → 无前置规则 → 缺函数 → 注册校验 → 暂停 / 阻断 → 求值 → 拒绝`。
 */
import { matchKeys, normalizeName } from '../ontology-doc.js';
import { catalogSignature, loadGateCatalog } from './catalog.js';
import { evaluateRules } from './evaluate.js';
import { declaredTypeOf } from './field-path.js';
import {
  blockedPostDetails,
  blockedPostMessage,
  denyDetails,
  denyMessage,
  pauseDetails,
  pauseMessage,
  postBlock,
} from './format.js';
import type {
  BehaviorRuleBucket,
  DenyReason,
  EvaluateContext,
  FailedCondition,
  GateSnapshot,
  PostHintInput,
  PostHintResult,
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
        const bucket = findBucket(snap, prepareInput.toolName);

        // 1. 不是任何已部署本体的行为 → 按"函数"记录后执行
        if (bucket === null) return { kind: 'function' };

        // 2. 是行为但没有前置规则 → 直接执行，不产生任何附加
        if (bucket.pre.length === 0) return { kind: 'behavior' };

        // 3. 缺函数检查（值 `null` 不算缺：键存在即已执行）
        const missing = collectMissing(bucket.pre, prepareInput.record);
        if (missing.length > 0) {
          // 4. 注册校验**先于**暂停：不存在的函数不该让模型空转补调
          const unregistered = collectUnregistered(missing, prepareInput.available);
          const affected = missing.map((item) => item.rule);
          if (unregistered.length > 0) {
            return denyResult(bucket.ref, 'unregistered', affected, { unregistered });
          }
          return {
            kind: 'pause',
            message: pauseMessage(
              bucket.ref,
              affected,
              missing.map((item) => item.functions),
            ),
            details: pauseDetails(
              bucket.ref,
              affected,
              missing.map((item) => item.functions),
            ),
            diagnosis: {
              ontologyKey: bucket.ref.ontologyKey,
              behaviorName: bucket.ref.behaviorName,
              rules: affected.map((rule) => rule.name),
              missingFunctions: [...new Set(missing.flatMap((item) => item.functions))],
            },
          };
        }

        // 5. `rule_design` 缺失：不阻断，但要留痕（`FR-022`，每条只告警一次）
        for (const rule of bucket.pre) {
          if (rule.design !== null || rule.designInvalid === true) continue;
          const key = `${rule.behavior}:${rule.name}`;
          if (warnedNoDesign.has(key)) continue;
          warnedNoDesign.add(key);
          report([`${key}:rule_without_design`]);
        }

        // 6. 结构非法（rule_design 存在但不是对象）→ fail-closed，先于求值
        const invalid = bucket.pre.find((rule) => rule.designInvalid === true);
        if (invalid !== undefined) {
          return denyResult(bucket.ref, 'config_unavailable', [invalid], {});
        }

        // 7. 求值（不短路，失败条件带出）
        const outcome = evaluateRules(bucket.pre, buildContext(snap, prepareInput.record));
        if (!outcome.passed) {
          const failedRules = rulesOf(outcome.failed, bucket.pre);
          return denyResult(bucket.ref, 'condition_false', failedRules, {
            failed: outcome.failed,
          });
        }

        return { kind: 'behavior' };
      } catch {
        return {
          kind: 'deny',
          message: FALLBACK_MESSAGE,
          details: FALLBACK_DETAILS,
          reason: 'config_unavailable',
        };
      }
    },

    postHint(postInput: PostHintInput): PostHintResult {
      try {
        const snap = ensureSnapshot();
        const bucket = findBucket(snap, postInput.toolName);
        if (bucket === null || bucket.post.length === 0) return null;

        // 后置注册校验：行为**已经执行成功**，这里只决定"提不提示"
        const unregistered = collectRuleUnregistered(bucket.post, postInput.available);
        if (unregistered.length > 0) {
          const rules = bucket.post.map((rule) => rule.name);
          return {
            kind: 'blocked',
            message: blockedPostMessage(bucket.ref),
            details: blockedPostDetails(bucket.ref, bucket.post, unregistered),
            rules,
            diagnosis: {
              ontologyKey: bucket.ref.ontologyKey,
              behaviorName: bucket.ref.behaviorName,
              rules,
              unregisteredFunctions: unregistered,
            },
          };
        }

        const rules = bucket.post.map((rule) => rule.name);
        return {
          kind: 'append',
          text: postBlock(bucket.post),
          rules,
          diagnosis: {
            ontologyKey: bucket.ref.ontologyKey,
            behaviorName: bucket.ref.behaviorName,
            rules,
          },
        };
      } catch {
        return {
          kind: 'blocked',
          message: FALLBACK_MESSAGE,
          details: FALLBACK_DETAILS,
          rules: [],
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

/** 归一行为名查桶（`matchKeys` 同时给完整名与去前缀名） */
function findBucket(snap: GateSnapshot, toolName: string): BehaviorRuleBucket | null {
  for (const key of matchKeys(toolName)) {
    const bucket = snap.behaviorIndex.get(key);
    if (bucket !== undefined) return bucket;
  }
  return null;
}

interface MissingFunctions {
  rule: RuleSpec;
  functions: string[];
}

/** 每条规则各自"没执行过"的函数（`related_functions` 为空则永不缺） */
function collectMissing(rules: RuleSpec[], record: PrepareInput['record']): MissingFunctions[] {
  const missing: MissingFunctions[] = [];
  for (const rule of rules) {
    const absent = rule.relatedFunctions.filter((fn) => !record.has(fn));
    if (absent.length > 0) missing.push({ rule, functions: absent });
  }
  return missing;
}

/** 缺失函数里有谁**未注册**（判据只有 `available` 集合，`FR-043`） */
function collectUnregistered(
  missing: MissingFunctions[],
  available: ReadonlySet<string>,
): string[] {
  const all = new Set<string>();
  for (const item of missing) {
    for (const fn of item.functions) all.add(fn);
  }
  return [...all].filter((fn) => !available.has(normalizeName(fn)));
}

/** 后置规则的全部函数里谁未注册（不要求"未执行"，只查可用性） */
function collectRuleUnregistered(rules: RuleSpec[], available: ReadonlySet<string>): string[] {
  const all = new Set<string>();
  for (const rule of rules) {
    for (const fn of rule.relatedFunctions) all.add(fn);
  }
  return [...all].filter((fn) => !available.has(normalizeName(fn)));
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
