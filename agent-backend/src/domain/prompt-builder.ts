/**
 * 正文池的 prompt 组装（002 工具结果受控回灌 + R11 后台计算结果）。
 *
 * 抽成独立模块的原因（宪章原则二）：`run-manager.ts` 因本特性新增产出段后越过
 * 500 行硬门禁；而"把素材拼成发给模型的 messages / systemExtra"本来就是与
 * "run 生命周期管理"不同的职责。
 *
 * 本模块是**纯函数**：不做 IO、不落盘，素材全部由调用方（run-manager）读好后传入
 * ⇒ 同样的历史得到同样的拼装结果（确定性，不破坏 prompt 前缀缓存）。
 */
import type { HistoryMessage } from '../types.js';
import { POOL_MAX_MESSAGES } from './context-window.js';
import { toLlmContent } from './message-format.js';
import { formatArtifactIndex, formatReplayBlock, selectReplay } from './tool-context.js';
import type { ToolCallRecord } from './tool-events.js';

export interface PromptSources {
  /** 会话 id：外置结果的索引路径由它与 call_id 重新推导（不读记录里的路径） */
  threadId: string;
  /** 摘要文本 + 归档游标（前多少条已并入摘要）；未装配摘要时为 `{ summary: '', coveredCount: 0 }` */
  summaryData: { summary: string; coveredCount: number };
  /** 该会话的全部历史消息（时间正序） */
  allMessages: readonly HistoryMessage[];
  /** 本轮用户消息（尚未落盘，追加在末尾） */
  userMessage: HistoryMessage;
  /** 工具调用记录（未装配 toolEvents 时为空数组） */
  records: readonly ToolCallRecord[];
  /** 已拼好的「后台计算结果」段（无产出时为空串） */
  producedText: string;
}

/**
 * 组本轮 prompt。
 *
 * 工具结果**不整体注入**：内联结果按预算回灌到**对应轮次**的 assistant 消息
 * （历史侧，带位置感）；外置结果只在 systemExtra 留一行索引，模型按需
 * `read_file` 自取。投影每次现算、不落盘，故 `history.jsonl` 保持纯净，
 * 前端展示不受影响（原则五：单一权威源）。
 */
export function buildPromptMessages(sources: PromptSources): {
  messages: HistoryMessage[];
  systemExtra?: string;
} {
  // 正文池 = `[已归档, 总数)`；未装配摘要时游标为 0（等于全量），由下面的上限兜底收口
  const pooled = sources.allMessages.slice(sources.summaryData.coveredCount);
  // 兜底：摘要长期失败时游标不推进，池子会超上限 —— 截到末尾 POOL_MAX 条。
  // 此时退回"末尾窗口"口径，可能短暂出现空洞，属降级行为（不阻断对话）。
  const bounded = pooled.length > POOL_MAX_MESSAGES ? pooled.slice(-POOL_MAX_MESSAGES) : pooled;
  const recent: HistoryMessage[] = [...bounded, sources.userMessage];

  // 工具回灌投影（未装配 toolEvents 时 records 为空，等于既有行为）
  const selection = selectReplay(sources.records, sources.threadId);
  const extraByMessage = new Map<string, string[]>();
  const addExtra = (messageId: string, text: string): void => {
    const exist = extraByMessage.get(messageId);
    if (exist) exist.push(text);
    else extraByMessage.set(messageId, [text]);
  };
  for (const item of selection.replay) addExtra(item.messageId, formatReplayBlock(item));
  for (const item of selection.placeholders) addExtra(item.messageId, item.text);

  const messages = recent.map((m) => {
    let content = toLlmContent(m);
    const extras = m.role === 'assistant' && m.id ? extraByMessage.get(m.id) : undefined;
    if (extras && extras.length > 0) content += `\n\n${extras.join('\n\n')}`;
    return { role: m.role, content };
  });

  // FR-017：滚动摘要；002：外置工具结果索引；R11：后台计算结果清单。
  // 三者都是"有内容才占位"——无内容时不占一个字符
  const parts: string[] = [];
  if (sources.summaryData.summary !== '') {
    parts.push(`以下是对话早期内容的摘要：\n${sources.summaryData.summary}`);
  }
  const indexText = formatArtifactIndex(selection.index);
  if (indexText !== '') parts.push(indexText);
  if (sources.producedText !== '') parts.push(sources.producedText);
  return { messages, ...(parts.length > 0 ? { systemExtra: parts.join('\n\n') } : {}) };
}
