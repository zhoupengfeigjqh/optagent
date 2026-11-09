/**
 * 本体行为规则闸门（021）的共享类型与常量。
 *
 * 口径来源：`specs/021-ontology-rule-gate/data-model.md` §2/§3/§4/§6 与
 * `contracts/rule-gate.md` §1。本文件**只有类型与常量**，无逻辑、无 IO。
 *
 * 两条硬约束在这里体现：
 * 1. 错误码**总数 2 个**（暂停 1 + 中止 1）；阻断复用中止码，靠 `DenyReason` 区分；
 * 2. `PrepareInput.available` 是注册校验的**唯一判据**，闸门不得自建"已注册函数"清单。
 */

/** 暂停通道的码（工具失败结果） */
export const RULE_FUNCTIONS_MISSING_CODE = 'ONTOLOGY_RULE_FUNCTIONS_MISSING' as const;

/** 中止/阻断通道的码（失败轮 `error.code`） */
export const RULE_DENIED_CODE = 'ONTOLOGY_RULE_DENIED' as const;

/** 两个码的只读清单（契约与测试用于核对"没有第三个"） */
export const RULE_GATE_CODES = [RULE_FUNCTIONS_MISSING_CODE, RULE_DENIED_CODE] as const;

export type RuleGateCode = (typeof RULE_GATE_CODES)[number];

/**
 * 中止原因三分类（进 `details` 与日志，**不新增错误码**）。
 *
 * - `unregistered`：规则引用的函数未注册（前置不执行 / 后置已执行后放弃提示）
 * - `condition_false`：`rule_design` 求值为 `false`
 * - `config_unavailable`：`rules` 段或 `rule_design` 结构非法、求值器异常
 */
export type DenyReason = 'unregistered' | 'condition_false' | 'config_unavailable';

/** 规则的出现时机（与 `ontology.yaml` 原文一致，仅认这两个值） */
export type RulePosition = '前置' | '后置';

/** 条件组合方式 */
export type CombineMode = 'and' | 'or';

/** 算子全集（16 个；顺序稳定，便于快照断言） */
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

/** 字段声明类型（取自 `functions[].response`；未声明为 `undefined`） */
export type DeclaredType = 'boolean' | 'integer' | 'number' | 'string' | undefined;

/** 一个已归一的判定条件 */
export interface RuleCondition {
  /** 函数名（裸名；比对走归一） */
  function: string;
  /** 业务数据路径（`pass` / `detail.qty` / `items[].qty`） */
  field: string;
  operator: OperatorCode;
  /** 恒为字符串数组 */
  values: string[];
  /**
   * 该条件**恒判不成立**（未知算子、缺 `function`/`field`）。
   *
   * 保留条目而不是丢弃：`or` 组合需要"这一条为假"而不是"这一条不存在"。
   */
  invalid?: boolean;
}

/** 一组条件的组合 */
export interface RuleConditionGroup {
  combine: CombineMode;
  conditions: RuleCondition[];
}

/** 归一后的 `rule_design` */
export interface RuleDesign {
  combine: CombineMode;
  groups: RuleConditionGroup[];
  passMessage?: string;
  failMessage?: string;
}

/** 一条已归一的规则（`raw` 保留原文，供"规则全部内容反馈"） */
export interface RuleSpec {
  name: string;
  title: string;
  description: string;
  /** 绑定行为名（原文，判定时归一） */
  behavior: string;
  position: RulePosition;
  /** 声明需要的函数名（裸名） */
  relatedFunctions: string[];
  dataSupplements: string[];
  design: RuleDesign | null;
  /**
   * `rule_design` **存在但不是对象**（结构非法）→ fail-closed。
   *
   * 与"缺失"区分开：缺失是"未设计"（`FR-022`，不阻断），
   * 非对象是配置错误（`FR-025`，拒绝并中止）。
   */
  designInvalid?: boolean;
  passMessage: string;
  failMessage: string;
  raw: Record<string, unknown>;
}

/** 行为引用（文案与日志的展示口径） */
export interface BehaviorRef {
  /** `{场景目录}/{本体目录}` */
  ontologyKey: string;
  scenarioName: string;
  ontologyName: string;
  behaviorName: string;
}

/** 轮内函数执行记录：键存在 = 本轮已执行过（值可能为 `null`） */
export interface FunctionRecord {
  /** 写入（成败都写；失败传 `null`）；不抛 */
  add(toolName: string, result: unknown): void;
  has(toolName: string): boolean;
  get(toolName: string): unknown;
  readonly size: number;
}

/** 前置判定的输入（纯数据，不含 logger / MCP / run 状态） */
export interface PrepareInput {
  /** 模型发起的工具名（可能是 `{服务名}__{工具名}`） */
  toolName: string;
  record: FunctionRecord;
  /** 本轮挂载给模型的工具名（已归一，含内置）——注册校验的唯一判据 */
  available: ReadonlySet<string>;
}

/** 后置判定的输入与前置同形 */
export type PostHintInput = PrepareInput;

/**
 * 判定诊断（包装器写结构化日志用）。
 *
 * 只承载"已经发生的事实"，不参与判决；缺失时日志省略对应字段。
 */
export interface RuleDiagnosis {
  ontologyKey: string;
  behaviorName: string;
  rules: string[];
  missingFunctions?: string[];
  unregisteredFunctions?: string[];
  failedConditions?: FailedCondition[];
}

/** 前置判定的四种结局 */
export type PrepareResult =
  | { kind: 'function' }
  | { kind: 'behavior' }
  | { kind: 'pause'; message: string; details: string[]; diagnosis?: RuleDiagnosis }
  | {
      kind: 'deny';
      message: string;
      details: string[];
      reason: DenyReason;
      diagnosis?: RuleDiagnosis;
    };

/** 后置判定的三种结局 */
export type PostHintResult =
  | null
  | { kind: 'append'; text: string; rules: string[]; diagnosis?: RuleDiagnosis }
  | {
      kind: 'blocked';
      message: string;
      details: string[];
      rules: string[];
      diagnosis?: RuleDiagnosis;
    };

/** 闸门端口：`prepare` / `postHint` **永不抛错** */
export interface RuleGatePort {
  prepare(input: PrepareInput): PrepareResult;
  postHint(input: PostHintInput): PostHintResult;
  invalidate(): void;
}

/** 工厂入参：只给"数字人目录 + 告警出口" */
export interface RuleGateInput {
  agentDir: string;
  /** 加载期告警出口（一次重载一次，交装配层写日志） */
  warn?: (warnings: string[]) => void;
}

/**
 * 某行为的规则分组（同一行为可挂多个本体，按本体键升序合并）。
 *
 * 空分组也是**有效条目**：它表示"该工具是本体行为，只是没有规则"，
 * 与"不是本体行为（按函数记录）"必须区分开（`FR-002` / `FR-012`）。
 */
export interface BehaviorRuleBucket {
  /** 行为引用（取合并顺序第一条所属本体，用于文案） */
  ref: BehaviorRef;
  pre: RuleSpec[];
  post: RuleSpec[];
}

/** 一次加载得到的不可变快照（测试与诊断用） */
export interface GateSnapshot {
  /** 目录签名（`ontology` 根目录 mtimeMs，或 `missing`） */
  signature: string;
  /** 归一行为名 → 规则分组 */
  behaviorIndex: Map<string, BehaviorRuleBucket>;
  /** 归一函数名 → `functions[].response` 声明 */
  functionResponses: Map<string, unknown>;
  warnings: string[];
}

/** 求值上下文：读取记录与字段声明类型 */
export interface EvaluateContext {
  /** 取记录值；键不存在或值为 `null` 都返回 `found=false` */
  resultOf(functionName: string): { found: boolean; value: unknown };
  /** 取字段声明类型（未声明为 `undefined`） */
  declaredTypeOf(functionName: string, field: string): DeclaredType;
}

/** 一次求值的结果 */
export interface EvaluationOutcome {
  passed: boolean;
  /** 未成立的条件（最多 10 条；不短路） */
  failed: FailedCondition[];
}

/** 未成立条件的摘要（日志与 `details` 的唯一来源） */
export interface FailedCondition {
  rule: string;
  function: string;
  field: string;
  operator: string;
}
