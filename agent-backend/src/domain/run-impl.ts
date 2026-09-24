/**
 * Run 实例（002 特性拆分：run-manager 单文件 ≤500 行，宪章原则二）。
 *
 * 只承载"一次对话轮次"的**内存状态与事件广播**：
 * - 订阅（SSE 侧）与广播
 * - 中断（AbortController + HITL 挂起点收尾）
 * - 本轮累积正文、assistant 消息 id、进行中的工具调用（供工具事件归属与耗时计算）
 *
 * 生命周期编排（并发配额、落盘、收尾、onCrash）留在 `RunManager`。
 */
import { InteractionGate } from './interaction-gate.js';
import type { RunState, SsePayload } from './run-events.js';

export interface Run {
  readonly threadId: string;
  readonly state: RunState;
  /** 订阅事件流；返回退订函数（客户端断开时调用，run 不受影响） */
  subscribe(cb: (e: SsePayload) => void): () => void;
  stop(): void;
  /** 收尾完成（含落盘与 usage 记录）后 resolve；永不 reject */
  readonly settled: Promise<void>;
}

export class RunImpl implements Run {
  state: RunState = 'running';
  readonly controller = new AbortController();
  buffer = '';
  settled!: Promise<void>;
  /** run 开始时间（注入时钟），用于整轮耗时统计 */
  startedAt = 0;
  /**
   * 本轮 assistant 消息 id：**启动时生成**（而非收尾时）。
   *
   * 工具事件行要带它做归属（前端据此把工具卡片挂到对应气泡），
   * 而工具调用发生在收尾之前，所以 id 必须提前存在。
   */
  assistantMessageId = '';
  /** 本轮进行中的工具调用（call_id → 开始信息），供结束行计算耗时 */
  readonly toolCalls = new Map<string, { name: string; startedAt: string; startedAtMs: number }>();
  /**
   * 人工确认交互门（HITL）：挂起点建立时经 onCreated 广播 interaction_request；
   * gate 本身即 InteractionSink，直接作为 interactionSink 传给 agent.run
   */
  readonly gate = new InteractionGate({
    onCreated: (payload) => this.emit({ type: 'interaction_request', data: payload }),
    onLog: (message) => this.logInteraction?.(message),
  });
  private readonly subs = new Set<(e: SsePayload) => void>();
  /** 交互审计日志（构造时注入；迟绑定读取，gate 字段初始化早于构造函数体赋值） */
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
        /* 订阅者异常不影响其他订阅者与落盘器 */
      }
    }
  }

  stop(): void {
    this.controller.abort();
    // HITL：中断时全部挂起点按 reject 收尾，等待中的工具调用不会悬挂
    this.gate.drain();
  }
}
