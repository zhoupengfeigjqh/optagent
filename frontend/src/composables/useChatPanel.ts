
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

import { MAX_MESSAGE_CHARS } from '../api/messages'
import type { ErrorInfo, FeedbackValue, FileReference, ToolTip } from '../api/types'
import { RUN_PHASE } from '../constants/events'
import { attachmentOnlyPrompt } from '../utils/attachment-only-prompt'
import type { ViewLinkTarget } from '../utils/view-link'
import { useAgents } from './useAgents'
import { useChatHeaderActions } from './useChatHeaderActions'
import { useChatInteraction } from './useChatInteraction'
import { useChatStream } from './useChatStream'
import { stripMentionTokens, useFileMention } from './useFileMention'
import { useMentionComposer } from './useMentionComposer'
import { useSkillComposer } from './useSkillComposer'
import { skillToken, stripSkillToken, useSkillMention } from './useSkillMention'
import { useMcpReadyGate } from './useMcpReadyGate'
import { useModels } from './useModels'
import { useNextStepPrompt } from './useNextStepPrompt'
import { useNextSteps } from './useNextSteps'
import { usePreview } from './usePreview'
import { useSessionSearch } from './useSessionSearch'
import { useTermNormalize } from './useTermNormalize'
import { useThreads } from './useThreads'
import { useThrottledText } from './useThrottledText'
import { useSession } from './useAppSession'
import { useToast } from './useToast'
import { useUploadPanel } from './useUploadPanel'
import { useUploads } from './useUploads'
import { useWorkspace } from './useWorkspace'

/** 创建聊天区装配 view-model（必须在 `setup()` 内调用）。 */
export function useChatPanel() {
  const chat = useChatStream()
  const threads = useThreads()
  const search = useSessionSearch()
  const models = useModels()
  const uploads = useUploads()
  const mention = useFileMention()
  const skill = useSkillMention()
  const workspace = useWorkspace()
  const session = useSession()
  const emptyHint = session.emptyHint
  const schedule = session.schedule
  const agents = useAgents()
  const mcpReady = useMcpReadyGate()
  const preview = usePreview()
  const nextSteps = useNextSteps()
  const toast = useToast()

  onMounted(async () => {
    // 工具栏需要模型清单：仅在本轮尚未取到时拉取（失败由 `useModels` 自行降级，不阻断聊天）
    if (models.models.value.length === 0) {
      void models.load()
    }
    await agents.loadCurrent()
    agents.startMcpSubscription()
  })

  onBeforeUnmount(() => {
    agents.stopMcpSubscription()
  })

  const streamingTextView = useThrottledText(chat.streamingText)
  const streamingThinkingView = useThrottledText(chat.streamingThinking)

  const streaming = computed(() => {
    const phase = chat.phase.value
    if (phase === RUN_PHASE.IDLE || phase === RUN_PHASE.COMPLETED) {
      return null
    }
    return {
      phase,
      text: streamingTextView.value,
      thinking: streamingThinkingView.value,
      toolCalls: chat.toolCalls.value,
      segments: chat.segments.value,
      // 静默兜底（TR-66）：超过 2.5s 没有任何业务事件时，气泡底部改说「模型正在思考…」
      stalled: chat.stalled.value,
      error: chat.error.value,
      agentName: chat.streamingAgentName.value,
      canRegenerate:
        (phase === RUN_PHASE.ABORTED || phase === RUN_PHASE.FAILED) &&
        chat.lastRetryableTurn.value !== null,
    }
  })

  const isFailed = computed(() => chat.phase.value === RUN_PHASE.FAILED)
  const errorInfo = computed<ErrorInfo | null>(() => chat.error.value)
  const sending = computed(() => chat.phase.value === RUN_PHASE.STREAMING)
  const hasMessages = computed(() => threads.messages.value.length > 0)

  const pendingUserMessage = computed(() => chat.pendingUserMessage.value)


  const hitl = useChatInteraction(chat, threads)


  async function onSend(
    payload: {
      content: string
      attachments: FileReference[]
      guidance?: string
      toolTips?: ToolTip[]
      skipIntentFocus?: boolean
      skipTermCheck?: boolean
      skill?: string | null
    },
    options: { settleBeforeReturn?: boolean } = {},
  ): Promise<boolean> {
    // 正在等 MCP 就绪：直接忽略重复点击（否则会排队发两轮）
    if (mcpReady.preparing.value) return false

    const selectedSkill =
      payload.skill && payload.content.includes(skillToken(payload.skill)) ? payload.skill : null
    let content = stripSkillToken(
      stripMentionTokens(payload.content, payload.attachments),
      selectedSkill,
    )
    const attachmentOnly = content.trim() === '' && payload.attachments.length > 0
    if (attachmentOnly) content = attachmentOnlyPrompt(payload.attachments.length)
    if (content.trim() === '') {
      toast.push('error', '请输入消息内容')
      return false
    }

    // 2026-11-26：与服务端 `MAX_CONTENT_CHARS` 同值。超限在本地拦下——否则用户要等完
    if (content.length > MAX_MESSAGE_CHARS) {
      toast.push(
        'error',
        `消息过长（${content.length}/${MAX_MESSAGE_CHARS} 字符），请拆分后发送`,
      )
      return false
    }

    // 粘贴待发件豁免：它们本来就还没落盘，紧接着会被 `flushPending` 写进临时空间。
    const missing = payload.attachments.filter(
      (reference) => !workspace.exists(reference) && !uploadPanel.isPending(reference),
    )
    if (missing.length > 0) {
      toast.push('error', `引用的文件已不存在：${missing.map((item) => item.filename).join('、')}`)
      return false
    }

    // 026：合成话术是机器生成的，不对它弹术语替换确认（否则"文件/查看"这类词会莫名弹窗）
    const manual =
      !attachmentOnly &&
      payload.skipTermCheck !== true &&
      !payload.guidance &&
      !payload.toolTips &&
      payload.skipIntentFocus !== true
    if (manual && (await termGate.review({ content, payload, options }))) return false

    await mcpReady.waitMcpReady()

    const attachments = await uploadPanel.flushPending(payload.attachments)
    if (attachments === null) return false

    if (!threads.activeId.value) {
      await threads.create()
      if (!threads.activeId.value) {
        return false
      }
    }

    const previous = payload.content
    chat.draft.value = ''
    nextSteps.reset()
    const run = chat.send({
      content,
      attachments,
      ...(payload.guidance ? { guidance: payload.guidance } : {}),
      ...(payload.toolTips && payload.toolTips.length > 0 ? { toolTips: payload.toolTips } : {}),
      ...(payload.skipIntentFocus === true ? { skipIntentFocus: true } : {}),
      ...(selectedSkill ? { skill: selectedSkill } : {}),
    })
    if (options.settleBeforeReturn === false) {
      // 弹窗即刻关闭。`chat.send` 内部永不 reject（错误一律转 phase），故 fire-and-forget 安全；
      void run
      return true
    }
    await run
    if (chat.phase.value === RUN_PHASE.FAILED) {
      chat.draft.value = previous
      return false
    }
    uploadPanel.commitPending(attachments)
    mention.reset()
    skill.reset()
    return true
  }

  const termGate = useTermNormalize({ api: session.termNormalize, send: onSend })

  function onStop(): void {
    void chat.stop()
  }

  async function onRegenerate(): Promise<void> {
    const turn = chat.lastRetryableTurn.value
    if (!turn) {
      return
    }
    // 018：重发的是历史里已确认过的文本，不再过替换预检（否则会二次弹窗）
    await onSend({ content: turn.content, attachments: turn.attachments, skipTermCheck: true })
  }

  function onRetryTurn(payload: { content: string; attachments: FileReference[] }): void {
    if (sending.value) {
      return
    }
    void onSend({ ...payload, skipTermCheck: true })
  }

  function onRetryFailedRun(): void {
    if (streaming.value?.canRegenerate) {
      void onRegenerate()
      return
    }
    onRecover()
  }


  const prompt = useNextStepPrompt({
    streaming,
    currentAgent: agents.currentAgent,
    send: onSend,
    toast,
  })

  function onLoadMore(): void {
    void threads.loadMore()
  }

  function onRecover(): void {
    void chat.recover()
  }

  /** 反馈提交：乐观更新 + 失败回滚由 `useChatStream.submitFeedback` 承担（V-08）。 */
  function onFeedback(payload: { message_id: string; value: FeedbackValue }): void {
    void chat.submitFeedback(payload.message_id, payload.value)
  }


  function onToggleThinking(): void {
    chat.setThinking(!chat.thinkingEnabled.value)
  }

  function onSelectModel(model: string): void {
    models.select(model)
  }


  // 这里只交出它们的状态源；展开而非逐条重列，避免出口清单两处维护。
  const headerActions = useChatHeaderActions({ agents, preview, search, workspace })


  function onOpenLink(href: string): void {
    preview.openLink(href)
  }

  function onOpenFile(reference: FileReference): void {
    void preview.openFile(reference)
  }

  function onOpenView(item: ViewLinkTarget): void {
    void preview.openView(item)
  }

  function onUpdateDraft(value: string): void {
    chat.draft.value = value
  }

  function onSendFromToolbar(): void {
    void onSend({
      content: chat.draft.value.trim(),
      attachments: mention.buildAttachments(),
      skill: skill.selected.value,
    })
  }


  /** 文本与引用必须同步的那条不变式写在该模块头部；这里只交出浮层状态与输入区文本。 */
  const mentionComposer = useMentionComposer({ mention, draft: chat.draft })


  const skillComposer = useSkillComposer({ skill, draft: chat.draft })

  function onInputText(payload: { value: string; caret: number }): void {
    mentionComposer.onInputText(payload)
    skillComposer.onInputText(payload)
  }

  watch(chat.draft, (text) => skill.sync(text))


  /**
   * 面板接线整体在 `useUploadPanel`（本文件逼近 500 行门禁，宪章原则二）。
   * 放在 `mentionComposer` 之后：成功回写复用它的 `onPickFile`（唯一入口），
   * 不另写一套 `@` 拼写与上限判断。
   */
  const uploadPanel = useUploadPanel({
    uploads,
    workspace,
    acceptUpload: mentionComposer.onPickFile,
    toast,
    // 粘贴是"一批"进来的：先判引用上限，再决定要不要传（避免传了却只引用得了一半）
    referenceCount: () => mention.references.value.length,
    // 重名检查取最新清单：workspace 缓存可能是几十秒前的（agent 也会往临时空间写文件）
    listFiles: (dir) => session.files.list(dir),
    references: () => mention.references.value,
    agent: () => agents.currentAgent.value?.agent_name ?? null,
    thread: () => threads.activeId.value,
    draft: () => chat.draft.value,
  })
  const { uploadOpen, onToggleUpload, onCloseUpload, onPickFiles, onPasteFiles, onRetryUpload } =
    uploadPanel

  return {
    chat,
    threads,
    search,
    models,
    uploads,
    mention,
    workspace,
    emptyHint,
    agents,
    schedule,
    uploadOpen,
    ...headerActions,
    streaming,
    isFailed,
    errorInfo,
    sending,
    preparing: mcpReady.preparing,
    hasMessages,
    pendingUserMessage,
    ...hitl,
    onSend,
    onStop,
    onRegenerate,
    onRetryTurn,
    onRetryFailedRun,
    nextSteps,
    // 展开而非逐条重列，避免"清单两处各维护一份"这种最容易漏的漂移
    ...prompt,
    // 018：替换确认弹窗（状态 + 3 个出口）来自 `useTermNormalize`，同样展开避免清单两处维护
    ...termGate,
    onLoadMore,
    onRecover,
    onFeedback,
    onToggleThinking,
    onSelectModel,
    onToggleUpload,
    onCloseUpload,
    onPickFiles,
    onPasteFiles,
    onRetryUpload,
    onOpenLink,
    onOpenFile,
    onOpenView,
    onUpdateDraft,
    onSendFromToolbar,
    ...mentionComposer,
    ...skillComposer,
    onInputText,
    skill,
  }
}
