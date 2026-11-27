import { normalizeName, stripServicePrefix } from '../ontology-doc.js';
import type { FunctionRecord } from './types.js';

/** 单条结果序列化上限（字节） */
export const MAX_ENTRY_BYTES = 256 * 1024;

/** 条目数上限 */
export const MAX_ENTRIES = 64;

export interface RecordDropInfo {
  toolName: string;
  reason: 'oversize' | 'overflow';
  bytes?: number;
  count?: number;
}

export interface FunctionRecordOptions {
  warn?: (info: RecordDropInfo) => void;
}

interface RecordEntry {
  value: unknown;
  epoch: number;
}

export function createFunctionRecord(options: FunctionRecordOptions = {}): FunctionRecord {
  const entries = new Map<string, RecordEntry>();
  let epoch = 0;

  return {
    add(toolName: string, result: unknown, at?: number): void {
      const key = recordKey(toolName);
      if (key === '') return;

      const value = result === null || result === undefined ? null : extractBusinessData(result);

      if (value !== null) {
        const bytes = utf8Bytes(safeJson(value));
        if (bytes > MAX_ENTRY_BYTES) {
          entries.delete(key);
          options.warn?.({ toolName: key, reason: 'oversize', bytes });
          return;
        }
      }

      if (!entries.has(key) && entries.size >= MAX_ENTRIES) {
        options.warn?.({ toolName: key, reason: 'overflow', count: entries.size });
        return;
      }

      // 派发世代：缺省用当前世代；显式传入时按传入值打戳（并行批次的保守降级）
      entries.set(key, { value, epoch: at ?? epoch });
    },

    has(toolName: string): boolean {
      const entry = entries.get(recordKey(toolName));
      return entry !== undefined && entry.epoch === epoch;
    },

    get(toolName: string): unknown {
      const entry = entries.get(recordKey(toolName));
      return entry !== undefined && entry.epoch === epoch ? entry.value : undefined;
    },

    hasEver(toolName: string): boolean {
      return entries.has(recordKey(toolName));
    },

    invalidate(): void {
      epoch += 1;
    },

    get epoch(): number {
      return epoch;
    },

    get size(): number {
      return entries.size;
    },

    get activeSize(): number {
      let count = 0;
      for (const entry of entries.values()) {
        if (entry.epoch === epoch) count += 1;
      }
      return count;
    },
  };
}

export function recordKey(toolName: string): string {
  return normalizeName(stripServicePrefix(toolName));
}

export function extractBusinessData(result: unknown): unknown {
  let value = result;

  const envelope = asRecord(value);
  if (envelope !== null && envelope.content !== undefined && isContentBlocks(envelope.content)) {
    value = envelope.content.map((block) => block.text).join('');
  }

  if (isContentBlocks(value)) {
    value = value.map((block) => block.text).join('');
  }

  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }

  if (Array.isArray(value)) return { count: value.length, items: value };

  const record = asRecord(value);
  if (record === null) return {};

  if (
    Object.prototype.hasOwnProperty.call(record, 'data') &&
    ('success' in record || 'error' in record || 'status' in record)
  ) {
    return normalizeExtracted(record.data);
  }

  return normalizeExtracted(record);
}

function normalizeExtracted(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { count: value.length, items: value };
  const record = asRecord(value);
  return record ?? {};
}

function isContentBlocks(value: unknown): value is { text: string }[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((item) => {
    const record = asRecord(item);
    return record !== null && typeof record.text === 'string';
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
