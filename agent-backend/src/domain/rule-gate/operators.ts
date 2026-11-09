/**
 * 16 个算子的类型强制与比较（纯函数，**全 total**：永不抛、只返回布尔）。
 *
 * 比较口径（`data-model.md` §3.2 / `FR-020`）：
 * - `values` 恒为字符串，解释时按**字段声明类型**强制；
 * - 未声明类型时按字符串精确比较（数值算子除外，转不出数字即不成立）；
 * - 类型不适用（如对数字用 `contains`）一律判**不成立**，`not_contains` 也不例外
 *   ——"取反"不能把"用错算子"变成"条件成立"。
 */
import { valueCountOf } from './design.js';
import type { DeclaredType, OperatorCode } from './types.js';

/** `matches` 的待比较文本上限（超长直接判不成立，避免正则回溯拖垮一轮） */
export const REGEX_MAX_INPUT = 4096;

/** 按声明类型强制一个**规则侧**字符串；失败返回 `undefined` */
export function coerceOperatorValue(raw: string, type: DeclaredType): string | number | boolean | undefined {
  switch (type) {
    case 'boolean':
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      return undefined;
    case 'integer':
    case 'number': {
      if (raw.trim() === '') return undefined;
      const value = Number(raw);
      return Number.isFinite(value) ? value : undefined;
    }
    case 'string':
      return raw;
    default:
      return raw;
  }
}

/** "空"的口径：`undefined` / `null` / `''` / 空数组 / 无键对象 */
export function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/**
 * 判定一个条件是否成立（**永不抛**）。
 *
 * @param actual 记录里取到的业务数据（调用方已保证"字段存在"）
 */
export function compareValue(
  actual: unknown,
  operator: OperatorCode,
  values: string[],
  type: DeclaredType,
): boolean {
  const arity = valueCountOf(operator);

  if (arity === 0) {
    return operator === 'empty' ? isEmptyValue(actual) : !isEmptyValue(actual);
  }

  if (arity === -1) {
    if (values.length < 1) return false;
  } else if (values.length !== arity) {
    return false;
  }

  if (actual === undefined || actual === null) return false;

  switch (operator) {
    case 'eq': {
      const equal = looseEquals(actual, values[0]!, type);
      return equal ?? false;
    }
    case 'ne': {
      const equal = looseEquals(actual, values[0]!, type);
      return equal === undefined ? false : !equal;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = toNumber(actual);
      const right = toNumber(values[0]!);
      if (left === undefined || right === undefined) return false;
      if (operator === 'gt') return left > right;
      if (operator === 'gte') return left >= right;
      if (operator === 'lt') return left < right;
      return left <= right;
    }
    case 'between': {
      const left = toNumber(actual);
      const low = toNumber(values[0]!);
      const high = toNumber(values[1]!);
      if (left === undefined || low === undefined || high === undefined) return false;
      return left >= low && left <= high;
    }
    case 'contains': {
      const included = includesValue(actual, values[0]!);
      return included ?? false;
    }
    case 'not_contains': {
      const included = includesValue(actual, values[0]!);
      return included === undefined ? false : !included;
    }
    case 'starts_with':
      return typeof actual === 'string' && actual.startsWith(values[0]!);
    case 'ends_with':
      return typeof actual === 'string' && actual.endsWith(values[0]!);
    case 'matches':
      return matchesSafe(actual, values[0]!);
    case 'in':
      return values.includes(stringOf(actual));
    case 'not_in':
      return !values.includes(stringOf(actual));
    default:
      return false;
  }
}

/** `eq` / `ne` 的公共比较；`undefined` 表示两侧无法按声明类型比较 */
function looseEquals(actual: unknown, value: string, type: DeclaredType): boolean | undefined {
  const left = toComparable(actual, type);
  const right = coerceOperatorValue(value, type);
  if (left === undefined || right === undefined) return undefined;
  return left === right;
}

/** 实际值 → 可比较标量（对象/数组转 JSON 文本；未声明类型按字符串） */
function toComparable(actual: unknown, type: DeclaredType): string | number | boolean | undefined {
  if (type === 'boolean') {
    if (typeof actual === 'boolean') return actual;
    if (typeof actual === 'string') return coerceOperatorValue(actual, 'boolean');
    return undefined;
  }
  if (type === 'integer' || type === 'number') {
    if (typeof actual === 'number') return Number.isFinite(actual) ? actual : undefined;
    if (typeof actual === 'string') return coerceOperatorValue(actual, 'number');
    return undefined;
  }
  if (type === 'string') {
    if (typeof actual === 'string') return actual;
    if (typeof actual === 'number' || typeof actual === 'boolean') return String(actual);
    return undefined;
  }

  // 未声明类型：按字符串精确比较（数值算子不走这里，见 `toNumber`）
  if (actual === undefined || actual === null) return undefined;
  if (typeof actual === 'object') return jsonText(actual);
  return String(actual);
}

/** `contains` / `not_contains`：字符串子串或数组成员；类型不适用返回 `undefined` */
function includesValue(actual: unknown, value: string): boolean | undefined {
  if (typeof actual === 'string') return actual.includes(value);
  if (Array.isArray(actual)) return actual.some((item) => stringOf(item) === value);
  return undefined;
}

/** 正则匹配：非字符串、超长、非法正则一律判不成立（不抛） */
function matchesSafe(actual: unknown, pattern: string): boolean {
  if (typeof actual !== 'string') return false;
  if (actual.length > REGEX_MAX_INPUT) return false;
  try {
    return new RegExp(pattern).test(actual);
  } catch {
    return false;
  }
}

/** 数值化：只认有限数字与数字字符串（`true` / `null` 不算数） */
function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    if (value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
