/**
 * 工具记录的上下文投影（002 特性：受控回灌）。
 *
 * 唯一形态：**工具结果只进 messages，不进系统提示词**（2026-11-07）。
 * - 内联结果：按预算从最近往前回灌 `inline_content`，拼进**对应轮次**的 assistant 消息
 *   （历史侧，带位置感）；外部来源的截断版同样走这条路径——它的末尾自带副本路径，
 *   模型需要全文时自己 `read_file`，不再依赖 systemPrompt 的索引段
 * - 预算耗尽：降级为一行占位；外置结果的占位**带副本路径**，
 *   否则被挤出的结果会彻底失联（模型不知道它可以取回）
 *
 * 本模块是**纯函数**：不做 IO、不落盘。投影结果每次组 prompt 时现算，
 * `tool-events.jsonl` 是唯一权威源（不存第二份可漂移的数据）。
 */
import { SPACE_TMP } from './dirs.js';
import type { ToolCallRecord } from './tool-events.js';
import { artifactRelPath, formatBytes } from './tool-result.js';

/**
 * 每轮 prompt 中工具结果原文的总预算（字节）。
 *
 * **不变式（MUST）**：`TOOL_INLINE_MAX_BYTES ≤ 本值`。预算同时充当"单条回灌上限"
 * （见 `selectReplay` 的 `bytes <= remaining`），若单条内联上限超过预算，内联结果永远
 * 装不进去、回灌会静默全部退化为占位。守这条不变式的是 `tests/unit/tool-context.spec.ts`。
 *
 * 2026-11-07 起外部来源的截断版也占这份预算（不再另有不占预算的索引行），
 * 故"预算内能放几条大结果"直接由本值与 `TOOL_INLINE_MAX_BYTES` 的比值决定。
 */
export const TOOL_REPLAY_BUDGET_BYTES = 128 * 1024;
/** 被预算挤出的结果最多留几条占位 */
export const TOOL_PLACEHOLDER_MAX_ITEMS = 20;

export interface ReplayItem {
  messageId: string;
  callId: string;
  name: string;
  text: string;
}

export interface ReplaySelection {
  /** 按时间正序：回灌原文（或截断版）的结果 */
  replay: ReplayItem[];
  /** 按时间正序：被预算挤出的结果（只留一行说明） */
  placeholders: ReplayItem[];
}

export interface SelectReplayOptions {
  budgetBytes?: number;
  placeholderMaxItems?: number;
}

/**
 * 从最近往前按预算挑选回灌内容；只有**终态且留有正文**的记录参与
 * （running 记录无结果，外置失败且未落副本的存量记录无 `content`）。
 *
 * @param threadId 会话 id：占位行的副本路径由它与 call_id **重新推导**（不读数据里的路径）
 */
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

/**
 * 占位行文案：只说"哪条结果被省略、完整的那份在哪"。
 *
 * 外置结果 MUST 带副本路径——被预算挤出后，索引段已不存在（2026-11-07 删除），
 * 这是模型唯一还能知道"可以 read_file 取回"的来源。
 */
function placeholderText(record: ToolCallRecord, threadId: string): string {
  const bytes = record.size ?? record.artifactSize;
  const sizeText = bytes === undefined ? '' : `（${formatBytes(bytes)}）`;
  if (record.artifactSize === undefined) {
    return `[工具 ${record.name} 结果已省略${sizeText}]`;
  }
  const relPath = artifactRelPath(threadId, record.callId, SPACE_TMP);
  return `[工具 ${record.name} 结果已省略${sizeText}，完整正文在 ${relPath}，可用 read_file 读取]`;
}

/** 回灌块（拼在对应 assistant 消息正文之后） */
export function formatReplayBlock(item: ReplayItem): string {
  return `[工具 ${item.name} 结果]\n${item.text}`;
}
