
export const RULE_FUNCTIONS_MISSING_CODE = 'ONTOLOGY_RULE_FUNCTIONS_MISSING' as const;

export const RULE_DENIED_CODE = 'ONTOLOGY_RULE_DENIED' as const;

export const RULE_GATE_CODES = [RULE_FUNCTIONS_MISSING_CODE, RULE_DENIED_CODE] as const;

export type RuleGateCode = (typeof RULE_GATE_CODES)[number];

export type DenyReason = 'unregistered' | 'condition_false' | 'config_unavailable';

/**
 * 规则的出现时机（与 `ontology.yaml` 原文一致）。
 *
 * 2026-11-24：**只实现前置**。后置规则本版整体移除、待重新设计——
 * 加载时 `position: 后置` 静默跳过（只保留"该名字是本体行为"这一事实，
 * 避免它被误当普通函数记录），既不求值也不追加提示，见 `catalog.ts`。
 */
export type RulePosition = '前置' | '后置';

export type BehaviorOpType = 'command' | 'query';

export type InvalidBehaviorReason = 'bad_op_type' | 'op_type_conflict' | 'undeclared';

export interface BehaviorOpTypeSource {
  ontologyKey: string;
  opType: string;
}

export interface InvalidBehavior {
  ref: BehaviorRef;
  reason: InvalidBehaviorReason;
  sources: readonly BehaviorOpTypeSource[];
}

export type CombineMode = 'and' | 'or';

export const OPERATOR_CODES = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches',
  'in',
  'not_in',
  'empty',
  'not_empty',
] as const;

export type OperatorCode = (typeof OPERATOR_CODES)[number];

export type DeclaredType = 'boolean' | 'integer' | 'number' | 'string' | undefined;

export interface RuleCondition {
  function: string;
  field: string;
  operator: OperatorCode;
  values: string[];
  invalid?: boolean;
}

export interface RuleConditionGroup {
  combine: CombineMode;
  conditions: RuleCondition[];
}

export interface RuleDesign {
  combine: CombineMode;
  groups: RuleConditionGroup[];
  passMessage?: string;
  failMessage?: string;
}

export interface RuleSpec {
  name: string;
  title: string;
  description: string;
  behavior: string;
  position: RulePosition;
  relatedFunctions: string[];
  dataSupplements: string[];
  design: RuleDesign | null;
  designInvalid?: boolean;
  passMessage: string;
  failMessage: string;
  raw: Record<string, unknown>;
}

export interface BehaviorRef {
  ontologyKey: string;
  scenarioName: string;
  ontologyName: string;
  behaviorName: string;
}

export interface FunctionRecord {
  /**
   * 写入（成败都写；失败传 `null`）；不抛。
   *
   * @param epoch 派发时刻的世代号（缺省 = 当前世代）。
   *   **并行批次必须传**：函数在 command 之前派发、在 command 之后返回时，
   *   按提交时的世代打戳会把它伪装成"写后计算"，必须按派发世代降级为过期。
   */
  add(toolName: string, result: unknown, epoch?: number): void;
  has(toolName: string): boolean;
  get(toolName: string): unknown;
  hasEver(toolName: string): boolean;
  invalidate(): void;
  readonly epoch: number;
  /** 总键数（含过期条目；上限判据） */
  readonly size: number;
  readonly activeSize: number;
}

export interface PrepareInput {
  toolName: string;
  record: FunctionRecord;
  available: ReadonlySet<string>;
}


export interface RuleDiagnosis {
  ontologyKey: string;
  behaviorName: string;
  rules: string[];
  missingFunctions?: string[];
  /**
   * 执行过、但结果产生于上一次 command 之前的函数（2026-11-24）。
   *
   * 与 `missingFunctions` 分开：文案必须让模型知道"不是没算，是算过但过期了"。
   */
  staleFunctions?: string[];
  unregisteredFunctions?: string[];
  failedConditions?: FailedCondition[];
}

export type PrepareResult =
  | { kind: 'function' }
  | {
      kind: 'behavior';
      command?: true;
    }
  | { kind: 'pause'; message: string; details: string[]; diagnosis?: RuleDiagnosis }
  | {
      kind: 'deny';
      message: string;
      details: string[];
      reason: DenyReason;
      diagnosis?: RuleDiagnosis;
    }
  | {
      kind: 'fatal';
      message: string;
      details: string[];
      reason: 'config_unavailable';
      cause: InvalidBehaviorReason;
      diagnosis?: RuleDiagnosis;
    };

export interface BehaviorLookup {
  toolName: string;
  command: boolean;
  relatedFunctions: string[];
  ref: BehaviorRef;
}

export interface RuleGatePort {
  prepare(input: PrepareInput): PrepareResult;
  invalidate(): void;
  /**
   * 只读查询（028 FR-029）：按工具名返回类型与前置函数。
   *
   * - 不是任何已部署本体的行为 → `null`；
   * - MUST NOT 修改判定状态、MUST NOT 写 `FunctionRecord`、MUST NOT 产生告警外的副作用。
   */
  lookupBehavior(toolName: string): BehaviorLookup | null;
}

export interface RuleGateInput {
  agentDir: string;
  warn?: (warnings: string[]) => void;
}

/**
 * 某行为的规则分组（同一行为可挂多个本体，按本体键升序合并）。
 *
 * 空分组也是**有效条目**：它表示"该工具是本体行为，只是没有规则"，
 * 与"不是本体行为（按函数记录）"必须区分开（`FR-002` / `FR-012`）。
 */
export interface BehaviorRuleBucket {
  ref: BehaviorRef;
  command: boolean;
  pre: RuleSpec[];
}

/** 一次加载得到的不可变快照（测试与诊断用） */
export interface GateSnapshot {
  signature: string;
  behaviorIndex: Map<string, BehaviorRuleBucket>;
  /**
   * 归一行为名 → 非法成因（2026-11-24）。
   *
   * 命中即 fatal，必须**先于**"不是本体行为"判定：否则非法行为会落到
   * `function` 分支被照常执行并写进记录，配置错误变成静默放行。
   */
  invalidBehaviors: Map<string, InvalidBehavior>;
  functionResponses: Map<string, unknown>;
  warnings: string[];
}

export interface EvaluateContext {
  resultOf(functionName: string): { found: boolean; value: unknown };
  declaredTypeOf(functionName: string, field: string): DeclaredType;
}

export interface EvaluationOutcome {
  passed: boolean;
  failed: FailedCondition[];
}

export interface FailedCondition {
  rule: string;
  function: string;
  field: string;
  operator: string;
}
