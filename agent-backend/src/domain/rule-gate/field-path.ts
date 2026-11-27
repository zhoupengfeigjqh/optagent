import type { DeclaredType } from './types.js';

export interface FieldSegment {
  name: string;
  array: boolean;
}

export interface FieldPath {
  segments: FieldSegment[];
}

export interface FieldRead {
  found: boolean;
  value: unknown;
}

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
    if (name === '' || name.includes('[') || name.includes(']')) return null;
    segments.push({ name, array });
  }
  return { segments };
}

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
    if (!projecting && missing > 0) return { found: false, value: undefined };
    if (next.length === 0) return { found: false, value: undefined };
    values = next;
  }

  return { found: true, value: projecting || values.length > 1 ? values : values[0] };
}

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
