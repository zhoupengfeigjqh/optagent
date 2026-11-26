import { SPACE_TMP } from './dirs.js';
import type { ToolCallRecord } from './tool-events.js';
import { artifactRelPath, formatBytes } from './tool-result.js';

export const TOOL_REPLAY_BUDGET_BYTES = 128 * 1024;
export const TOOL_PLACEHOLDER_MAX_ITEMS = 20;

export interface ReplayItem {
  messageId: string;
  callId: string;
  name: string;
  text: string;
}

export interface ReplaySelection {
  replay: ReplayItem[];
  placeholders: ReplayItem[];
}

export interface SelectReplayOptions {
  budgetBytes?: number;
  placeholderMaxItems?: number;
}

export function selectReplay(
  records: readonly ToolCallRecord[],
  threadId: string,
  options: SelectReplayOptions = {},
): ReplaySelection {
  const budget = options.budgetBytes ?? TOOL_REPLAY_BUDGET_BYTES;
  const placeholderMax = options.placeholderMaxItems ?? TOOL_PLACEHOLDER_MAX_ITEMS;

  const replay: ReplayItem[] = [];
  const placeholders: ReplayItem[] = [];
  let remaining = budget;

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!;
    if (record.status === 'running') continue;
    if (record.content === undefined) continue;

    const bytes = Buffer.byteLength(record.content, 'utf8');
    // 预算本身即单条上限：remaining ≤ 总预算，故不需要另设单条阈值
    if (bytes <= remaining) {
      replay.push({
        messageId: record.messageId,
        callId: record.callId,
        name: record.name,
        text: record.content,
      });
      remaining -= bytes;
      continue;
    }
    if (placeholders.length < placeholderMax) {
      placeholders.push({
        messageId: record.messageId,
        callId: record.callId,
        name: record.name,
        text: placeholderText(record, threadId),
      });
    }
  }

  replay.reverse();
  placeholders.reverse();
  return { replay, placeholders };
}

function placeholderText(record: ToolCallRecord, threadId: string): string {
  const bytes = record.size ?? record.artifactSize;
  const sizeText = bytes === undefined ? '' : `（${formatBytes(bytes)}）`;
  if (record.artifactSize === undefined) {
    return `[工具 ${record.name} 结果已省略${sizeText}]`;
  }
  const relPath = artifactRelPath(threadId, record.callId, SPACE_TMP);
  return `[工具 ${record.name} 结果已省略${sizeText}，完整正文在 ${relPath}，可用 read_file 读取]`;
}

export function formatReplayBlock(item: ReplayItem): string {
  return `[工具 ${item.name} 结果]\n${item.text}`;
}
