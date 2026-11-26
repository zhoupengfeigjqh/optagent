
export const SSE_EVENT = {
  THINKING: 'thinking',
  CONTENT: 'content',
  TOOL_CALL: 'tool_call',
  TOOL_CALL_END: 'tool_call_end',
  /** 028 FR-034：计划进度（单行，只带当前步；不落盘、不进历史） */
  PLAN_PROGRESS: 'plan_progress',
  INTERACTION_REQUEST: 'interaction_request',
  DONE: 'done',
  ERROR: 'error',
} as const

export type SseEventName = (typeof SSE_EVENT)[keyof typeof SSE_EVENT]

export const SSE_TERMINAL_EVENTS: ReadonlySet<string> = new Set<string>([
  SSE_EVENT.DONE,
  SSE_EVENT.ERROR,
])

export const FINISH_REASON = {
  COMPLETED: 'completed',
  STOP: 'stop',
} as const

export type FinishReason = (typeof FINISH_REASON)[keyof typeof FINISH_REASON]

export const RUN_PHASE = {
  IDLE: 'idle',
  STREAMING: 'streaming',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ABORTED: 'aborted',
} as const

export type RunPhase = (typeof RUN_PHASE)[keyof typeof RUN_PHASE]

export const TOOL_STATUS = {
  RUNNING: 'running',
  SUCCESS: 'success',
  ERROR: 'error',
} as const

export type ToolStatus = (typeof TOOL_STATUS)[keyof typeof TOOL_STATUS]

export const MESSAGE_STATUS = {
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const

export const MESSAGE_ROLE = {
  USER: 'user',
  ASSISTANT: 'assistant',
} as const

export const FEEDBACK = {
  UP: 'up',
  DOWN: 'down',
} as const
