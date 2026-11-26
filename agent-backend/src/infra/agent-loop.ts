import type { Model, Provider } from '@earendil-works/pi-ai';
import {
  runAgentLoop,
  type AgentEvent,
  type AgentLoopConfig,
  type AgentTool,
  type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { LlmRetryOptions } from '../config.js';
import type { PlanProgress } from '../domain/plan/types.js';
import { classifyLlmFailure } from '../domain/llm-error.js';
import { markToolError } from '../domain/tool-error.js';
import { digestArgs, serializeToolResult } from '../domain/tool-result.js';
import type { HistoryMessage, LlmEvent, UsageInfo } from '../types.js';

export function createStreamFn(
  provider: Provider,
  apiKey: string,
  retry: LlmRetryOptions,
): StreamFn {
  return (model, context, options) =>
    provider.streamSimple(model as never, context, {
      ...options,
      apiKey,
      maxRetries: retry.maxRetries,
      maxRetryDelayMs: retry.maxRetryDelayMs,
    }) as never;
}

export interface RunAgentLoopHooks {
  prepareNextTurn?: (
    context: Parameters<NonNullable<AgentLoopConfig['prepareNextTurn']>>[0],
  ) => ReturnType<NonNullable<AgentLoopConfig['prepareNextTurn']>>;
  shouldStopAfterTurn?: (
    context: Parameters<NonNullable<AgentLoopConfig['shouldStopAfterTurn']>>[0],
  ) => ReturnType<NonNullable<AgentLoopConfig['shouldStopAfterTurn']>>;
  getFollowUpMessages?: NonNullable<AgentLoopConfig['getFollowUpMessages']>;
  /** 在 `markToolError` **之前**调用，只允许记录事实（不得改写结果） */
  afterToolCall?: (
    context: Parameters<NonNullable<AgentLoopConfig['afterToolCall']>>[0],
    signal?: AbortSignal,
  ) => Promise<void>;
}

export interface RunAgentLoopOptions {
  model: Model<never>;
  streamFn: StreamFn;
  systemPrompt: string;
  messages: HistoryMessage[];
  tools: AgentTool[];
  labelTools?: readonly AgentTool[];
  thinking: boolean;
  signal: AbortSignal;
  hooks?: RunAgentLoopHooks;
  /**
   * 028（FR-034）：`begin()` 期间已产生的计划进度（首步 `running` 等）。
   *
   * 规划发生在 loop 启动之前，而进度必须走同一条事件队列——调用方先攒起来，
   * 本层在开始迭代时补发。
   */
  planProgress?: readonly PlanProgress[];
  /** 028（FR-034）：把编排器的**实时**进度接到本层事件队列（队列就绪后调用一次） */
  onPlanProgress?: (emit: (event: PlanProgress) => void) => void;
}

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
} as const;

export async function* runAgentLoopEvents(opts: RunAgentLoopOptions): AsyncIterable<LlmEvent> {
  const queue: Array<LlmEvent | null> = [];
  let wakeup: (() => void) | null = null;
  const push = (e: LlmEvent | null) => {
    queue.push(e);
    wakeup?.();
  };

  const now = () => Date.now();
  const prompts = opts.messages.map((m) => {
    if (m.role === 'assistant') {
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

  const labels = new Map<string, string>();
  for (const tool of opts.labelTools ?? opts.tools) {
    const label = typeof tool.label === 'string' ? tool.label.trim() : '';
    if (label !== '') labels.set(tool.name, label);
  }

  /** 计划进度（028 FR-034）：补发 begin 期间积压的，再把实时回调接到队列 */
  const pushProgress = (event: PlanProgress): void => {
    push({ type: 'plan_progress', seqId: event.seqId, label: event.label, phase: event.phase });
  };
  if (opts.planProgress !== undefined) {
    for (const event of opts.planProgress) pushProgress(event);
  }
  opts.onPlanProgress?.(pushProgress);

  const emit = (event: AgentEvent): void => {
    if (event.type === 'message_update') {
      const ev = event.assistantMessageEvent;
      if (ev.type === 'thinking_delta') push({ type: 'thinking_delta', delta: ev.delta });
      else if (ev.type === 'text_delta') push({ type: 'content_delta', delta: ev.delta });
    } else if (event.type === 'tool_execution_start') {
      const argsDigest = digestArgs(event.args);
      const label = labels.get(event.toolName);
      push({
        type: 'tool_call_start',
        callId: event.toolCallId,
        name: event.toolName,
        ...(argsDigest ? { argsDigest } : {}),
        ...(label !== undefined ? { label } : {}),
      });
    } else if (event.type === 'tool_execution_end') {
      push({
        type: 'tool_call_end',
        callId: event.toolCallId,
        name: event.toolName,
        status: event.isError ? 'error' : 'success',
        resultText: serializeToolResult(event.result).text,
      });
    } else if (event.type === 'agent_end') {
      const usage: UsageInfo = { inputTokens: 0, outputTokens: 0 };
      for (const m of event.messages) {
        if (m.role !== 'assistant') continue;
        const u = (m as { usage?: { input: number; output: number } }).usage;
        if (u) {
          usage.inputTokens += u.input;
          usage.outputTokens += u.output;
        }
      }
      for (let i = event.messages.length - 1; i >= 0; i--) {
        const m = event.messages[i]!;
        if (m.role === 'assistant') {
          const stopReason = (m as { stopReason?: string }).stopReason;
          const errorMessage = (m as { errorMessage?: string }).errorMessage;
          if (stopReason === 'aborted') {
            push({
              type: 'error',
              ...classifyLlmFailure({
                ...(errorMessage ? { message: errorMessage } : {}),
                aborted: true,
              }),
              usage,
            });
            push(null);
            return;
          }
          if (stopReason === 'error') {
            push({
              type: 'error',
              ...classifyLlmFailure(errorMessage ? { message: errorMessage } : {}),
              usage,
            });
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
      toolExecution: 'sequential',
      ...(opts.thinking ? { reasoning: 'low' as const } : {}),
      convertToLlm: (msgs) =>
        msgs.filter(
          (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ) as never,
      afterToolCall: async (ctx, signal) => {
        if (opts.hooks?.afterToolCall !== undefined) {
          await opts.hooks.afterToolCall(ctx, signal);
        }
        return markToolError(ctx.result);
      },
      ...(opts.hooks?.prepareNextTurn !== undefined
        ? { prepareNextTurn: opts.hooks.prepareNextTurn }
        : {}),
      ...(opts.hooks?.shouldStopAfterTurn !== undefined
        ? { shouldStopAfterTurn: opts.hooks.shouldStopAfterTurn }
        : {}),
      ...(opts.hooks?.getFollowUpMessages !== undefined
        ? { getFollowUpMessages: opts.hooks.getFollowUpMessages }
        : {}),
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
