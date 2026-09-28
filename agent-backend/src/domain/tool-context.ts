/**
 * 工具记录的上下文投影（002 特性：受控回灌）。
 *
 * 核心约束：**工具结果原文永不整体注入提示词**，只按预算投影：
 * - 内联结果：按预算从最近往前回灌**原文**，拼进对应轮次的
 *   assistant 消息（历史侧，带"第几轮"的位置感）
 * - 外置结果：systemPrompt 里只留一行**索引**（名称 / 体积 / 摘要 / 路径），
 *   模型需要细节时自己 `read_file` 去取（业界策略 B）
 * - 预算耗尽的内联结果：降级为一行占位，保证模型"知道曾经有结果"而非完全失忆
 *
 * 本模块是**纯函数**：不做 IO、不落盘。投影结果每次组 prompt 时现算，
 * `tool-events.jsonl` 是唯一权威源（不存第二份可漂移的数据）。
 */
import { SPACE_TMP } from './dirs.js';
import type { ToolCallRecord } from './tool-events.js';
import { artifactRelPath, formatBytes } from './tool-result.js';

/** 每轮 prompt 中工具结果原文的总预算（字节） */
export const TOOL_REPLAY_BUDGET_BYTES = 32 * 1024;
/** systemPrompt 索引段最多列几条外置结果 */
export const TOOL_INDEX_MAX_ITEMS = 10;
/** 被预算挤出的内联结果最多留几条占位 */
export const TOOL_PLACEHOLDER_MAX_ITEMS = 20;

export interface ReplayItem {
  messageId: string;
  callId: string;
  name: string;
  text: string;
}

export interface ArtifactIndexItem {
  callId: string;
  name: string;
  size: number;
  summary: string;
  /** 临时空间相对路径（模型据此 read_file） */
  relPath: string;
}

export interface ReplaySelection {
  /** 按时间正序：回灌原文的内联结果 */
  replay: ReplayItem[];
  /** 按时间正序：被预算挤出的内联结果（只留一行说明） */
  placeholders: ReplayItem[];
  /** 外置结果的索引（按时间正序，最多 TOOL_INDEX_MAX_ITEMS 条） */
  index: ArtifactIndexItem[];
}

export interface SelectReplayOptions {
  budgetBytes?: number;
  indexMaxItems?: number;
  placeholderMaxItems?: number;
}

/**
 * 从最近往前按预算挑选回灌内容；只有**终态**记录参与（running 记录无结果）。
 *
 * 预算只被"原文回灌"消耗：索引与占位体积可忽略，因此不受预算约束，
 * 只受条数上限约束——避免长会话把 systemPrompt 撑大。
 *
 * @param threadId 会话 id：索引行的路径由它与 call_id **重新推导**（不读数据里的路径）
 */
export function selectReplay(
  records: readonly ToolCallRecord[],
  threadId: string,
  options: SelectReplayOptions = {},
): ReplaySelection {
  const budget = options.budgetBytes ?? TOOL_REPLAY_BUDGET_BYTES;
  const indexMax = options.indexMaxItems ?? TOOL_INDEX_MAX_ITEMS;
  const placeholderMax = options.placeholderMaxItems ?? TOOL_PLACEHOLDER_MAX_ITEMS;

  const replay: ReplayItem[] = [];
  const placeholders: ReplayItem[] = [];
  const index: ArtifactIndexItem[] = [];
  let remaining = budget;

  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i]!;
    if (record.status === 'running') continue;

    if (record.artifactSize !== undefined) {
      if (index.length < indexMax) {
        index.push({
          callId: record.callId,
          name: record.name,
          size: record.artifactSize,
          summary: record.summary ?? '',
          relPath: artifactRelPath(threadId, record.callId, SPACE_TMP),
        });
      }
      continue;
    }

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
        text: `[工具 ${record.name} 结果已省略（${formatBytes(bytes)}）]`,
      });
    }
  }

  replay.reverse();
  placeholders.reverse();
  index.reverse();
  return { replay, placeholders, index };
}

/** 回灌块（拼在对应 assistant 消息正文之后） */
export function formatReplayBlock(item: ReplayItem): string {
  return `[工具 ${item.name} 结果]\n${item.text}`;
}

/** 索引段（拼进 systemExtra；无外置结果时返回空串，不占一个字符） */
export function formatArtifactIndex(index: readonly ArtifactIndexItem[]): string {
  if (index.length === 0) return '';
  const lines = index.map((item) => {
    const parts = [`- ${item.name}`, formatBytes(item.size)];
    if (item.summary !== '') parts.push(item.summary);
    parts.push(item.relPath);
    return parts.join(' · ');
  });
  return [
    '【可用的工具结果原文】（需要细节时用 read_file 按路径读取，表格类内容优先用 grep 定位）',
    ...lines,
  ].join('\n');
}
