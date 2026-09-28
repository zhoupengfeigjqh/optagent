/**
 * pi-agent-core 低层 runAgentLoop 调用封装。
 *
 * 入参：systemPrompt、拼装后 messages、工具集（经 file-access 代理的 AgentTool）、signal；
 * 出参：统一为 LlmEvent 异步迭代（thinking_delta / content_delta / done(usage) / error）。
 * 工具执行由 loop 内部驱动；usage 从 agent_end 的最后一条 assistant 消息提取。
 */
import type { Model, Provider } from '@earendil-works/pi-ai';
import { runAgentLoop, type AgentEvent, type AgentTool, type StreamFn } from '@earendil-works/pi-agent-core';
import { digestArgs, serializeToolResult } from '../domain/tool-result.js';
import type { HistoryMessage, LlmEvent, UsageInfo } from '../types.js';

/** 由 pi-ai provider 构造 runAgentLoop 所需的 streamFn（请求级注入 apiKey） */
export function createStreamFn(provider: Provider, apiKey: string): StreamFn {
  return (model, context, options) =>
    provider.streamSimple(model as never, context, { ...options, apiKey }) as never;
}

export interface RunAgentLoopOptions {
  model: Model<never>;
  streamFn: StreamFn;
  systemPrompt: string;
  messages: HistoryMessage[];
  tools: AgentTool[];
  thinking: boolean;
  signal: AbortSignal;
}

/** 历史 assistant 消息的占位 usage（真实 token 已入 usage.db，此处仅为满足 pi 的消息结构） */
const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const;

export async function* runAgentLoopEvents(opts: RunAgentLoopOptions): AsyncIterable<LlmEvent> {
  const queue: Array<LlmEvent | null> = []; // null = 结束哨兵
  let wakeup: (() => void) | null = null;
  const push = (e: LlmEvent | null) => {
    queue.push(e);
    wakeup?.();
  };

  const now = () => Date.now();
  const prompts = opts.messages.map((m) => {
    if (m.role === 'assistant') {
      // pi 消息结构：assistant 的 content 是块数组；缺 usage 会读 undefined.totalTokens 崩溃。
      // 历史轮的真实 token 已入 usage.db，此处仅补结构占位。
      return {
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        stopReason: 'stop',
        usage: { ...ZERO_USAGE, cost: { ...ZERO_USAGE.cost } },
        timestamp: now(),
      };
    }
    return { role: m.role, content: m.content, timestamp: now() };
  });

  const emit = (event: AgentEvent): void => {
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent;
      if (ev.type === 'thinking_delta') push({ type: 'thinking_delta', delta: ev.delta });
      else if (ev.type === 'text_delta') push({ type: 'content_delta', delta: ev.delta });
    } else if (event.type === 'tool_execution_start') {
      // 入参只带**短标量摘要**（供展示"查了什么"）；原文永不下发（spec 002 FR-001）
      const argsDigest = digestArgs(event.args);
      push({
        type: 'tool_call_start',
        callId: event.toolCallId,
        name: event.toolName,
        ...(argsDigest ? { argsDigest } : {}),
      });
    } else if (event.type === 'tool_execution_end') {
      // 结果拍平成文本上行（由 run-manager 落 tool-events.jsonl）；
      // **SSE 仍只透出状态**，结果不经事件总线广播（spec 002 FR-002 的对外部分不变）
      push({
        type: 'tool_call_end',
        callId: event.toolCallId,
        name: event.toolName,
        status: event.isError ? 'error' : 'success',
        resultText: serializeToolResult(event.result).text,
      });
    } else if (event.type === 'agent_end') {
      // usage 精确统计：工具循环有多跳 LLM 调用，每跳产生一条带 usage 的
      // assistant 消息，须全部累加（只取最后一条会漏掉中间跳的大 prompt）
      const usage: UsageInfo = { inputTokens: 0, outputTokens: 0 };
      for (const m of event.messages) {
        if (m.role !== 'assistant') continue;
        const u = (m as { usage?: { input: number; output: number } }).usage;
        if (u) {
          usage.inputTokens += u.input;
          usage.outputTokens += u.output;
        }
      }
      // 中断/失败：取最后一条 assistant 消息的终止原因
      for (let i = event.messages.length - 1; i >= 0; i--) {
        const m = event.messages[i]!;
        if (m.role === 'assistant') {
          const stopReason = (m as { stopReason?: string }).stopReason;
          const errorMessage = (m as { errorMessage?: string }).errorMessage;
          if (stopReason === 'aborted') {
            push({ type: 'error', code: 'ABORTED', message: errorMessage ?? '已中断', usage });
            push(null);
            return;
          }
          if (stopReason === 'error') {
            push({ type: 'error', code: 'LLM_ERROR', message: errorMessage ?? 'LLM 调用失败', usage });
            push(null);
            return;
          }
          break;
        }
      }
      push({ type: 'done', usage });
      push(null);
    }
  };

  const loopPromise = runAgentLoop(
    prompts as never,
    { systemPrompt: opts.systemPrompt, messages: [], tools: opts.tools },
    {
      model: opts.model,
      ...(opts.thinking ? { reasoning: 'low' as const } : {}),
      convertToLlm: (msgs) =>
        msgs.filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult') as never,
    },
    emit,
    opts.signal,
    opts.streamFn,
  ).catch((err: unknown) => {
    push({
      type: 'error',
      code: 'LOOP_ERROR',
      message: err instanceof Error ? err.message : String(err),
    });
    push(null);
  });
  void loopPromise;

  for (;;) {
    while (queue.length > 0) {
      const e = queue.shift()!;
      if (e === null) return;
      yield e;
    }
    await new Promise<void>((resolve) => (wakeup = resolve));
    wakeup = null;
  }
}
