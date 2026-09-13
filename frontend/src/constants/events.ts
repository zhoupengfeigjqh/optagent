/**
 * SSE 事件名与状态机常量
 *
 * 事件名与 `contracts/backend-api.md` §4.2 一一对应；
 * 状态机取值与 `data-model.md` §13 的 `RunState` / `ToolCallState` 一致。
 */

/** SSE 事件类型（后端 `event:` 字段取值）。 */
export const SSE_EVENT = {
  THINKING: 'thinking',
  CONTENT: 'content',
  TOOL_CALL: 'tool_call',
  TOOL_CALL_END: 'tool_call_end',
  DONE: 'done',
  ERROR: 'error',
} as const

export type SseEventName = (typeof SSE_EVENT)[keyof typeof SSE_EVENT]

/** 终结事件集合：出现其一即结束本轮读取循环。 */
export const SSE_TERMINAL_EVENTS: ReadonlySet<string> = new Set<string>([
  SSE_EVENT.DONE,
  SSE_EVENT.ERROR,
])

/** `done.finish_reason` 取值。 */
export const FINISH_REASON = {
  /** 正常完成并落盘 */
  COMPLETED: 'completed',
  /** 本轮被中断，不落盘（`message_id` 为 null） */
  STOP: 'stop',
} as const

export type FinishReason = (typeof FINISH_REASON)[keyof typeof FINISH_REASON]

/** 本轮运行阶段（`RunState.phase`）。 */
export const RUN_PHASE = {
  IDLE: 'idle',
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
} as const

export type RunPhase = (typeof RUN_PHASE)[keyof typeof RUN_PHASE]

/** 工具调用状态（`ToolCallState.status`）。 */
export const TOOL_STATUS = {
  RUNNING: 'running',
  SUCCESS: 'success',
  ERROR: 'error',
} as const

export type ToolStatus = (typeof TOOL_STATUS)[keyof typeof TOOL_STATUS]

/** 消息状态（`Message.status`）。 */
export const MESSAGE_STATUS = {
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

/** 消息角色。 */
export const MESSAGE_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const

/** 反馈取值。 */
export const FEEDBACK = {
  UP: 'up',
  DOWN: 'down',
} as const
