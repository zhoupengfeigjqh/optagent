import type { ErrorInfo } from '../../api/types'
import type { RunPhase } from '../../constants/events'
import type { StreamSegment, ToolCallState } from '../../composables/useChatStream.types'

export type ToolCallView = ToolCallState

export type StreamSegmentView = StreamSegment

export interface StreamingView {
  phase: RunPhase
  text: string
  thinking: string
  toolCalls: ToolCallView[]
  error: ErrorInfo | null
  /** 本轮回答的数字人（009 起会话归属固定：数字人不可在会话中途变更；逐条标注保留以兼容存量数据） */
  agentName: string | null
  canRegenerate?: boolean
  stalled?: boolean
  segments?: StreamSegmentView[]
}
