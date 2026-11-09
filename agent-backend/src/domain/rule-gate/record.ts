/**
 * 轮内函数执行记录（纯内存，轮结束即丢）。
 *
 * 四条口径（`data-model.md` §4 / `FR-003` / `FR-005`）：
 * 1. **成败都记**：正常返回记业务数据，执行报错/超时/无结果记 `null`；
 * 2. **最后一次覆盖**：同名多次调用只留最后一条（失败同样覆盖成功）；
 * 3. **键存在 = 本轮已执行过**：值可能是 `null`，读取必须用 `has` / `get` 分离，
 *    禁止 `if (value)` 真值判断；
 * 4. **有界**：单条 ≤ 256 KB、条目 ≤ 64，超限丢弃并告警（丢弃 = 键不存在）。
 *
 * 本文件不含任何工具名、服务名或本体名（解耦红线）。
 */
import { normalizeName, stripServicePrefix } from '../ontology-doc.js';
import type { FunctionRecord } from './types.js';

/** 单条结果序列化上限（字节） */
export const MAX_ENTRY_BYTES = 256 * 1024;

/** 条目数上限 */
export const MAX_ENTRIES = 64;

/** 丢弃事件的元信息（不含结果正文） */
export interface RecordDropInfo {
  toolName: string;
  reason: 'oversize' | 'overflow';
  bytes?: number;
  count?: number;
}

export interface FunctionRecordOptions {
  /** 丢弃告警出口（装配层写 `rule_gate.record.dropped`） */
  warn?: (info: RecordDropInfo) => void;
}

/** 创建一个空记录（**每轮一个**） */
export function createFunctionRecord(options: FunctionRecordOptions = {}): FunctionRecord {
  const entries = new Map<string, unknown>();

  return {
    add(toolName: string, result: unknown): void {
      const key = recordKey(toolName);
      if (key === '') return;

      const value = result === null || result === undefined ? null : extractBusinessData(result);

      if (value !== null) {
        const bytes = utf8Bytes(safeJson(value));
        if (bytes > MAX_ENTRY_BYTES) {
          // 丢弃该条：键不存在 = 未执行（下一轮判定会重新要求补调）
          entries.delete(key);
          options.warn?.({ toolName: key, reason: 'oversize', bytes });
          return;
        }
      }

      if (!entries.has(key) && entries.size >= MAX_ENTRIES) {
        options.warn?.({ toolName: key, reason: 'overflow', count: entries.size });
        return;
      }

      entries.set(key, value);
    },

    has(toolName: string): boolean {
      return entries.has(recordKey(toolName));
    },

    get(toolName: string): unknown {
      return entries.get(recordKey(toolName));
    },

    get size(): number {
      return entries.size;
    },
  };
}

/** 记录键：去 MCP 服务前缀 + 去首尾空白 + 小写（与规则 `related_functions` 同名） */
export function recordKey(toolName: string): string {
  return normalizeName(stripServicePrefix(toolName));
}

/**
 * 从工具返回值里抽"业务数据部分"（`FR-006` 的唯一口径）。
 *
 * 顺序：
 * 1. `content` 块数组 → 拼接文本后按字符串处理；
 * 2. 数组 → `{ count, items }`；
 * 3. 字符串 → 按 JSON 解析，失败记 `{}`；
 * 4. 对象且**同时**含 `data` 与 `success`/`error`/`status` 之一（统一信封）→ 取 `data`；
 * 5. 其余对象 → 取对象本身（扁平服务）；
 * 6. 其它（数字/布尔/纯文本）→ `{}`。
 */
export function extractBusinessData(result: unknown): unknown {
  let value = result;

  // 工具结果信封（`AgentToolResult`）：`{ content: [{type:'text', text}], details }`
  // —— 真实 MCP / 内置工具都返回这个形态，业务字段在 content 的文本里。
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

/** 抽取结果再判"是否为对象"：数组补 `count/items`，非对象记 `{}` */
function normalizeExtracted(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { count: value.length, items: value };
  const record = asRecord(value);
  return record ?? {};
}

/** `[{ type: 'text', text }]` 形态的 content 块数组 */
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
