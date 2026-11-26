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

export { OPERATOR_CODES };

export function isOperatorCode(value: unknown): value is OperatorCode {
  return typeof value === 'string' && (OPERATOR_CODES as readonly string[]).includes(value);
}

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
