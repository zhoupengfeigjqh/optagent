/**
 * 聊天消息区共用的展示类型（2026-11-20 抽出）
 *
 * 此前 `MessageList` 与 `MessageBubble` 各自写了一份 `ToolCallView` / `StreamingView`，
 * 注释都写着"同构"，实际已经漂移：`stalled`（TR-66 静默兜底）与 `segments`（A-lite 段序）
 * 只加在 `MessageBubble` 一侧。因为两者都是可选字段，`vue-tsc` 不会报错——漂移只在
 * 运行期表现成"列表把字段传下去了、气泡的类型里却没有"。故收敛到此，两处同源。
 *
 * 工具项与渲染段不另立形状，直接取状态机的同名契约（`useChatStream.types`）：
 * 流式态只有名称 / 人读名称 / 状态，展示层不需要更多字段。
 *
 * 纯类型文件（零运行期代码），无同名测试（与 `api/types.ts` 同口径）；`coverage.include`
 * 只收 `api` / `composables` / `utils`，本文件不计入分母。
 */
import type { ErrorInfo } from '../../api/types'
import type { RunPhase } from '../../constants/events'
import type { StreamSegment, ToolCallState } from '../../composables/useChatStream.types'

/** 工具调用卡片在流式态的入参（= 状态机里的 `ToolCallState`）。 */
export type ToolCallView = ToolCallState

/** 流式渲染段（A-lite）：文字段与工具段按事件到达顺序排列。 */
export type StreamSegmentView = StreamSegment

/**
 * 本轮瞬态（不落历史）：思考、工具、阶段与错误。
 *
 * `phase` / `text` / `thinking` / `agentName` 是状态机字段的展示态改名（`useChatPanel`
 * 逐字段投影），`stalled` / `segments` 由同一处投影带出。
 */
export interface StreamingView {
  phase: RunPhase
  text: string
  thinking: string
  toolCalls: ToolCallView[]
  error: ErrorInfo | null
  /** 本轮回答的数字人（009 起会话归属固定：数字人不可在会话中途变更；逐条标注保留以兼容存量数据） */
  agentName: string | null
  /** 本轮是否有可重发的用户消息缓存（中断轮 / 服务端已终局的失败轮）→「重新生成」按钮渲染条件 */
  canRegenerate?: boolean
  /** 长时间无业务事件（TR-66）：>2.5s 没有 content/thinking/tool 事件时为 true */
  stalled?: boolean
  /** 渲染段（A-lite）：仅流式轮非空；缺省（历史/旧桩）走"工具在上、正文在下"的顺序 */
  segments?: StreamSegmentView[]
}
