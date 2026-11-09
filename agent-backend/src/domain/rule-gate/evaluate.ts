/**
 * 规则求值（纯计算：无 LLM、无网络、无时钟）。
 *
 * 两级合成（`data-model.md` §3）：组内 `combine` → 组间 `combine`（根）。
 * **不短路**：所有条件都求值，未成立的条件被收集（上限 10 条），
 * 用于 `details` 与 `rule_gate.denied.failed_conditions`。
 */
import { compareValue } from './operators.js';
import { readField } from './field-path.js';
import type {
  EvaluateContext,
  EvaluationOutcome,
  FailedCondition,
  RuleCondition,
  RuleDesign,
  RuleSpec,
} from './types.js';

/** 失败条件收集上限（日志与文案都只取前若干条） */
export const MAX_FAILED_CONDITIONS = 10;

/** 求一段 `rule_design` */
export function evaluateDesign(
  design: RuleDesign,
  ctx: EvaluateContext,
  ruleName: string,
): EvaluationOutcome {
  const failed: FailedCondition[] = [];

  const groupResults = design.groups.map((group) => {
    const conditionResults = group.conditions.map((condition) =>
      evaluateCondition(condition, ctx, ruleName, failed),
    );
    return group.combine === 'or' ? conditionResults.some(Boolean) : conditionResults.every(Boolean);
  });

  const passed =
    design.combine === 'or' ? groupResults.some(Boolean) : groupResults.every(Boolean);
  return { passed, failed };
}

/**
 * 求多条规则：**任一** `false` 即整体 `false`（逻辑与）。
 *
 * 全部参与求值（不短路），未成立条件跨规则累积。
 * `design === null` 的规则视为"无需计算"，既不阻断也不贡献失败项（`FR-022`）。
 */
export function evaluateRules(rules: RuleSpec[], ctx: EvaluateContext): EvaluationOutcome {
  const failed: FailedCondition[] = [];
  let passed = true;

  for (const rule of rules) {
    if (rule.design === null) continue;
    const outcome = evaluateDesign(rule.design, ctx, rule.name);
    if (!outcome.passed) passed = false;
    for (const item of outcome.failed) {
      if (failed.length >= MAX_FAILED_CONDITIONS) break;
      failed.push(item);
    }
  }

  return { passed, failed: failed.slice(0, MAX_FAILED_CONDITIONS) };
}

/** 单条条件：非法 / 函数未记录 / 字段缺失 / 比较不成立 → `false` */
function evaluateCondition(
  condition: RuleCondition,
  ctx: EvaluateContext,
  ruleName: string,
  failed: FailedCondition[],
): boolean {
  const record = (ok: boolean): boolean => {
    if (!ok && failed.length < MAX_FAILED_CONDITIONS) {
      failed.push({
        rule: ruleName,
        function: condition.function,
        field: condition.field,
        operator: condition.operator,
      });
    }
    return ok;
  };

  if (condition.invalid === true) return record(false);

  const result = ctx.resultOf(condition.function);
  if (!result.found) return record(false);

  const read = readField(result.value, condition.field);
  if (!read.found) return record(false);

  const declared = ctx.declaredTypeOf(condition.function, condition.field);
  return record(compareValue(read.value, condition.operator, condition.values, declared));
}
