/**
 * `rule_design` 的**读侧归一**（纯函数）。
 *
 * 原则：坏数据不抛、不拒绝整条规则，而是**降级成"恒不成立"的条件**——
 * 这样 `or` 组合里的其它分支仍可成立，且 `and` 组合一定失败（fail-closed）。
 */
import {
  OPERATOR_CODES,
  type CombineMode,
  type OperatorCode,
  type RuleCondition,
  type RuleConditionGroup,
  type RuleDesign,
} from './types.js';

/** 算子全集再导出（契约的唯一导出面从这里取） */
export { OPERATOR_CODES };

/** 算子是否在 16 个全集内 */
export function isOperatorCode(value: unknown): value is OperatorCode {
  return typeof value === 'string' && (OPERATOR_CODES as readonly string[]).includes(value);
}

/**
 * 算子需要的取值个数：`empty` / `not_empty` 为 0，`between` 为 2，
 * `in` / `not_in` 为"至少 1"（记为 `-1`），其余恰好 1。
 */
export function valueCountOf(operator: OperatorCode): number {
  switch (operator) {
    case 'empty':
    case 'not_empty':
      return 0;
    case 'between':
      return 2;
    case 'in':
    case 'not_in':
      return -1;
    default:
      return 1;
  }
}

/**
 * 归一 `rule_design`（**永不抛**）。
 *
 * - 非对象 / `groups` 非数组或为空 → `null`（视为"未设计"）；
 * - `combine` 非法 → `and`；
 * - 组内 `conditions` 非数组或为空 → 该组忽略 + 告警；
 * - 条件缺 `function` / `field`、算子不在全集 → 保留但标记 `invalid`；
 * - 组数 / 条数超限**不拒绝**（设计期约束，运行期照常求值）。
 */
export function normalizeDesign(raw: unknown, warnings: string[]): RuleDesign | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push('rule_design_not_object');
    return null;
  }

  const groupsRaw = record.groups;
  if (!Array.isArray(groupsRaw) || groupsRaw.length === 0) {
    warnings.push('rule_design_no_groups');
    return null;
  }

  const groups: RuleConditionGroup[] = [];
  for (const item of groupsRaw) {
    const group = asRecord(item);
    if (group === null) {
      warnings.push('rule_design_group_not_object');
      continue;
    }
    const conditionsRaw = group.conditions;
    if (!Array.isArray(conditionsRaw) || conditionsRaw.length === 0) {
      warnings.push('rule_design_group_no_conditions');
      continue;
    }
    const conditions: RuleCondition[] = [];
    for (const conditionRaw of conditionsRaw) {
      const condition = normalizeCondition(conditionRaw, warnings);
      if (condition !== null) conditions.push(condition);
    }
    if (conditions.length === 0) {
      warnings.push('rule_design_group_no_valid_conditions');
      continue;
    }
    groups.push({ combine: asCombine(group.combine), conditions });
  }

  if (groups.length === 0) {
    warnings.push('rule_design_no_valid_groups');
    return null;
  }

  const design: RuleDesign = { combine: asCombine(record.combine), groups };
  const passMessage = text(record.pass_message);
  if (passMessage !== undefined) design.passMessage = passMessage;
  const failMessage = text(record.fail_message);
  if (failMessage !== undefined) design.failMessage = failMessage;
  return design;
}

/** 单条条件归一：非对象丢弃；缺目标或未知算子 → `invalid` */
function normalizeCondition(raw: unknown, warnings: string[]): RuleCondition | null {
  const record = asRecord(raw);
  if (record === null) {
    warnings.push('rule_condition_not_object');
    return null;
  }

  const fn = text(record.function);
  const field = text(record.field);
  const operatorRaw = record.operator;
  const values = normalizeValues(record.values);

  if (fn === undefined || field === undefined) {
    warnings.push('rule_condition_missing_target');
    return { function: fn ?? '', field: field ?? '', operator: 'eq', values, invalid: true };
  }

  if (!isOperatorCode(operatorRaw)) {
    warnings.push(`rule_condition_unknown_operator:${String(operatorRaw)}`);
    return { function: fn, field, operator: 'eq', values, invalid: true };
  }

  return { function: fn, field, operator: operatorRaw, values };
}

/** `values` 恒为字符串数组：非数组单值包裹，元素统一 `String()` */
function normalizeValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (value === undefined) return [];
  return [String(value)];
}

function asCombine(value: unknown): CombineMode {
  return value === 'or' ? 'or' : 'and';
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
