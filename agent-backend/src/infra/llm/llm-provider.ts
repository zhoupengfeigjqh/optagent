import type { LlmEvent, ToolSpec } from '../../types.js';

export interface LlmChatRequest {
  systemPrompt: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  tools: ToolSpec[];
  thinking: boolean;
  signal: AbortSignal;
}

export interface LlmProvider {
  streamChat(req: LlmChatRequest): AsyncIterable<LlmEvent>;
}
