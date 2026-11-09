/**
 * 本体行为规则闸门（021）的**唯一导出面**。
 *
 * 外部只见四样：工厂 `createRuleGate` / `createFunctionRecord`、端口与决策类型、
 * 错误码常量、拒绝卡片文案（`RULE_TERMINAL_NOTICE` / `denyCardBody`）。
 * 解析、求值、文案模板、缓存都在包内部，改它们不会波及装配层。
 */
export { createRuleGate } from './gate.js';
export { RULE_TERMINAL_NOTICE, denyCardBody } from './format.js';
export { createFunctionRecord } from './record.js';
export {
  OPERATOR_CODES,
  RULE_DENIED_CODE,
  RULE_FUNCTIONS_MISSING_CODE,
  RULE_GATE_CODES,
} from './types.js';
export type {
  BehaviorRef,
  DeclaredType,
  DenyReason,
  FunctionRecord,
  GateSnapshot,
  OperatorCode,
  PostHintInput,
  PostHintResult,
  PrepareInput,
  PrepareResult,
  RuleCondition,
  RuleConditionGroup,
  RuleDesign,
  RuleDiagnosis,
  RuleGateCode,
  RuleGateInput,
  RuleGatePort,
  RuleSpec,
} from './types.js';
