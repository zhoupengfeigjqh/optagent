/**
 * LlmProvider 防腐接口（contracts/internal-interfaces.md §1）。
 * 业务层只依赖此签名；实现在 infra/llm/。
 */
import type { LlmEvent, ToolSpec } from '../../types.js';

export interface LlmChatRequest {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolSpec[];
  /** thinking 开关（请求级参数） */
  thinking: boolean;
  /** stop / 关机中断 */
  signal: AbortSignal;
}

export interface LlmProvider {
  streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent>;
}
