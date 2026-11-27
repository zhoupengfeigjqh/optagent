import { InteractionGate } from './interaction-gate.js';
import { TailCapture } from './next-actions-tail.js';
import type { RunState, SsePayload } from './run-events.js';

export interface Run {
  readonly threadId: string;
  readonly state: RunState;
  subscribe(cb: (e: SsePayload) => void): () => void;
  stop(): void;
  readonly settled: Promise<void>;
}

export class RunImpl implements Run {
  state: RunState = 'running';
  readonly controller = new AbortController();
  buffer = '';
  settled!: Promise<void>;
  startedAt = 0;
  /**
   * 本轮 assistant 消息 id：**启动时生成**（而非收尾时）。
   *
   * 工具事件行要带它做归属（前端据此把工具卡片挂到对应气泡），
   * 而工具调用发生在收尾之前，所以 id 必须提前存在。
   */
  assistantMessageId = '';
  readonly toolCalls = new Map<
    string,
    { name: string; label?: string; startedAt: string; startedAtMs: number }
  >();
  modelId?: string;
  readonly calledTools = new Set<string>();
  /**
   * 007 修订（Tail Protocol）：回答流尾部块捕获状态机。
   *
   * content 增量在 `consume` 里先过它再下发——命中 `<next_actions>` 后的增量
   * 只进缓冲不下发（用户不可见），轮末由 `run-finalize` 解析成卡片随 `done` 直推。
   */
  readonly tailCapture = new TailCapture();
  nextActionsTail = '';
  readonly gate = new InteractionGate({
    onCreated: (payload) => this.emit({ type: 'interaction_request', data: payload }),
    onLog: (message) => this.logInteraction?.(message),
  });
  private readonly subs = new Set<(e: SsePayload) => void>();
  private logInteraction: ((message: string) => void) | undefined;

  constructor(
    readonly threadId: string,
    readonly userId: string,
    readonly agentName: string,
    onLog?: (message: string) => void,
  ) {
    this.logInteraction = onLog;
  }

  subscribe(cb: (e: SsePayload) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  emit(e: SsePayload): void {
    for (const cb of [...this.subs]) {
      try {
        cb(e);
      } catch {
        // 单个订阅者异常不阻断其他订阅者
      }
    }
  }

  stop(): void {
    this.controller.abort();
    this.gate.drain();
  }
}
