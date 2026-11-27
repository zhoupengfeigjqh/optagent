import type { HistoryMessage } from '../types.js';
import { POOL_MAX_MESSAGES } from './context-window.js';
import { toLlmContent } from './message-format.js';
import { formatReplayBlock, selectReplay } from './tool-context.js';
import type { ToolCallRecord } from './tool-events.js';

export interface PromptSources {
  threadId: string;
  summaryData: { summary: string; coveredCount: number };
  allMessages: readonly HistoryMessage[];
  userMessage: HistoryMessage;
  records: readonly ToolCallRecord[];
  producedText: string;
  nowText?: string;
  guidance?: string;
}

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

  const parts: string[] = [];
  if (sources.summaryData.summary !== '') {
    parts.push(`以下是对话早期内容的摘要：\n${sources.summaryData.summary}`);
  }
  if (sources.producedText !== '') parts.push(sources.producedText);
  if (sources.nowText) parts.push(sources.nowText);
  //      注意：`guidance` 非空白时 `run-consume` 仍会跳过聚焦（`skipFocus` 第三条判据）；
  if (sources.guidance) parts.push(sources.guidance);
  return { messages, ...(parts.length > 0 ? { systemExtra: parts.join('\n\n') } : {}) };
}
