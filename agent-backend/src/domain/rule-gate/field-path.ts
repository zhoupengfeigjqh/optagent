/**
 * `field` 路径语法与读取（纯函数，无 IO）。
 *
 * 支持的形态（见 `data-model.md` §3.1）：
 * - `pass`：顶层字段；
 * - `detail.qty`：逐段对象路径；
 * - `items`：数组容器本身（配 `contains` / `empty`）；
 * - `items[].qty`：元素层字段投影；
 * - `a[].b[].c`：多层数组叠加。
 *
 * 两条口径：任一段缺失即 `found=false`；投影结果为空同样视为缺失。
 */
import type { DeclaredType } from './types.js';

/** 路径中的一段：字段名 + 是否数组投影 */
export interface FieldSegment {
  name: string;
  array: boolean;
}

/** 解析后的路径 */
export interface FieldPath {
  segments: FieldSegment[];
}

/** 一次读取的结果 */
export interface FieldRead {
  found: boolean;
  value: unknown;
}

/**
 * 解析 `field` 路径；非法返回 `null`（空串、空段、`[0]` 这类下标都会失败）。
 *
 * 只认 `[]`（元素层），不做下标/切片——规则设计里没有这些语义。
 */
export function parseFieldPath(raw: string): FieldPath | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const segments: FieldSegment[] = [];
  for (const part of trimmed.split('.')) {
    if (part === '') return null;
    let name = part;
    let array = false;
    if (part.endsWith('[]')) {
      array = true;
      name = part.slice(0, -2);
    }
    // 名字里出现方括号说明用了不支持的语法（下标、切片、嵌套）
    if (name === '' || name.includes('[') || name.includes(']')) return null;
    segments.push({ name, array });
  }
  return { segments };
}

/**
 * 按路径读取值（**永不抛**）。
 *
 * - 单值路径任一环缺失 → `found=false`；
 * - 一旦进入数组投影，缺失的元素被丢弃（投影为空同样 `found=false`）。
 */
export function readField(root: unknown, path: string | FieldPath): FieldRead {
  const parsed = typeof path === 'string' ? parseFieldPath(path) : path;
  if (parsed === null || parsed.segments.length === 0) return { found: false, value: undefined };

  let values: unknown[] = [root];
  let projecting = false;

  for (const segment of parsed.segments) {
    if (segment.array) {
      const next: unknown[] = [];
      for (const value of values) {
        const read = readKey(value, segment.name);
        if (!read.found || !Array.isArray(read.value)) return { found: false, value: undefined };
        for (const item of read.value) next.push(item);
      }
      values = next;
      projecting = true;
      continue;
    }

    const next: unknown[] = [];
    let missing = 0;
    for (const value of values) {
      const read = readKey(value, segment.name);
      if (read.found) next.push(read.value);
      else missing += 1;
    }
    // 单值路径：任一环缺失即整体缺失；投影模式：缺失元素丢弃
    if (!projecting && missing > 0) return { found: false, value: undefined };
    if (next.length === 0) return { found: false, value: undefined };
    values = next;
  }

  return { found: true, value: projecting || values.length > 1 ? values : values[0] };
}

/**
 * 从 `functions[].response` 声明里取字段类型。
 *
 * 兼容两种形态：
 * - **属性映射**：`{ pass: 'boolean', detail: { qty: 'integer' } }`；
 * - **JSON Schema**：`{ type:'object', properties: {...} }`（数组段下钻 `items.properties`）。
 *
 * 未声明 / 路径对不上 → `undefined`（按"未声明类型"求值，不拒绝）。
 */
export function declaredTypeOf(response: unknown, field: string): DeclaredType {
  const parsed = parseFieldPath(field);
  if (parsed === null) return undefined;

  let node: unknown = response;
  for (const segment of parsed.segments) {
    if (isSchemaObject(node)) {
      const properties = asRecord(asRecord(node)?.properties);
      node = properties?.[segment.name];
      if (segment.array) node = elementSchemaOf(node);
    } else {
      const record = asRecord(node);
      node = record?.[segment.name];
      if (segment.array) node = elementSchemaOf(node);
    }
    if (node === undefined) return undefined;
  }

  if (typeof node === 'string') return normalizeType(node);
  if (isSchemaObject(node)) return normalizeType(asRecord(node)?.type);
  return undefined;
}

/** 数组字段的元素类型声明：JSON Schema 取 `items`，属性映射取首元素或自身 */
function elementSchemaOf(node: unknown): unknown {
  if (Array.isArray(node)) return node[0];
  if (isSchemaObject(node)) return asRecord(node)?.items ?? node;
  return node;
}

function normalizeType(value: unknown): DeclaredType {
  return value === 'boolean' || value === 'integer' || value === 'number' || value === 'string'
    ? value
    : undefined;
}

/** JSON Schema 形态的判定：含 `properties` 或含字符串 `type` */
function isSchemaObject(value: unknown): boolean {
  const record = asRecord(value);
  if (record === null) return false;
  return record.properties !== undefined || typeof record.type === 'string';
}

function readKey(value: unknown, key: string): FieldRead {
  const record = asRecord(value);
  if (record === null) return { found: false, value: undefined };
  if (!Object.prototype.hasOwnProperty.call(record, key)) return { found: false, value: undefined };
  return { found: true, value: record[key] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
