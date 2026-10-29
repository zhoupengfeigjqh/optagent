/**
 * 聊天区装配 view-model（T081：自 `ChatPanel.vue` 拆分）
 *
 * 中栏的"接线"（跨 composable 的事件编排、纯 UI 开关、生命周期）集中在这里，
 * `ChatPanel.vue` 只保留 props、模板与"是否渲染列表"这一条与 props 相关的派生，
 * 从而满足"单文件 ≤500 行"（宪章原则二）。
 *
 * 状态来源不变：一律取自 `provide/inject` 的会话上下文，本模块不新增字段来源、不持有业务数据。
 */

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type { ErrorInfo, FeedbackValue, FileReference, ToolCallResult } from '../api/types'
import { RUN_PHASE } from '../constants/events'
import type { ViewLinkTarget } from '../utils/view-link'
import { useAgents } from './useAgents'
import { useChatStream } from './useChatStream'
import { stripMentionTokens, useFileMention } from './useFileMention'
import { useMentionComposer } from './useMentionComposer'
import { useMcpReadyGate } from './useMcpReadyGate'
import { useModels } from './useModels'
import { useNextStepPrompt } from './useNextStepPrompt'
import { useNextSteps } from './useNextSteps'
import { usePreview } from './usePreview'
import { useSessionSearch } from './useSessionSearch'
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
  const workspace = useWorkspace()
  // 014：引导判定已在 `useAppSession.onSwitched` 内完成，这里只取用装配好的状态（不加逻辑）
  const emptyHint = useSession().emptyHint
  const agents = useAgents()
  // 发送前的 MCP 就绪门（2026-10-18）：灰 → 有连接结果再提交，见该模块头注释
  const mcpReady = useMcpReadyGate()
  const preview = usePreview()
  const nextSteps = useNextSteps()
  const toast = useToast()

  /** 数字人面板展开状态 */
  const agentPanelOpen = ref(false)
  /**
   * 文件空间是否正停在列表态（用于工具栏按钮高亮与"再点一次收起"）。
   * 面板可能被消息内的文件引用打开在内容态，此时按钮不高亮。
   */
  const workspaceOpen = computed(() => preview.open.value && preview.view.value === 'list')

  onMounted(async () => {
    // 工具栏需要模型清单：仅在本轮尚未取到时拉取（失败由 `useModels` 自行降级，不阻断聊天）
    if (models.models.value.length === 0) {
      void models.load()
    }
    // 头部需要当前数字人与 MCP 状态；MCP 状态走后端 SSE 推送（建连落定/切换时主动下发）
    await agents.loadCurrent()
    agents.startMcpSubscription()
  })

  onBeforeUnmount(() => {
    agents.stopMcpSubscription()
  })

  /**
   * 流式正文/思考的**渲染影子**（2026-10-16）：状态仍逐 token 精确，界面按时间窗合并
   * （见 `useThrottledText`）。放在这一层而不是 `useChatStream`：节流纯属渲染优化，
   * 不该污染中断/重试/落盘那些有语义的状态与其测试。
   */
  const streamingTextView = useThrottledText(chat.streamingText)
  const streamingThinkingView = useThrottledText(chat.streamingThinking)

  /**
   * 本轮瞬态：`completed` 已由刷新后的历史消息承载，若继续下传会与持久化消息重复渲染，
   * 因此仅"进行中 / 失败 / 已中断"三种情况由气泡承载
   * （中断轮保留已生成内容，但不落盘、不展示操作与用量）。
   */
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
      error: chat.error.value,
      // 本轮气泡标注"谁在回答"（009 起会话归属固定，标注用于如实还原存量历史）
      agentName: chat.streamingAgentName.value,
      // 「重新生成」/「重试本轮」是否可用：本轮的用户消息仍在缓存里（中断轮，或服务端已终局的失败轮）
      canRegenerate:
        (phase === RUN_PHASE.ABORTED || phase === RUN_PHASE.FAILED) &&
        chat.lastRetryableTurn.value !== null,
    }
  })

  const isFailed = computed(() => chat.phase.value === RUN_PHASE.FAILED)
  const errorInfo = computed<ErrorInfo | null>(() => chat.error.value)
  const sending = computed(() => chat.phase.value === RUN_PHASE.STREAMING)
  const hasMessages = computed(() => threads.messages.value.length > 0)

  /**
   * 本轮乐观用户气泡（十七次调整）：发送即出现，流终结时清除。
   * 仅做 `Ref → 模板 prop` 的解包，语义与生命周期全部留在 `useChatStream`。
   */
  const pendingUserMessage = computed(() => chat.pendingUserMessage.value)

  /* ---------- HITL：工具调用人工确认 ---------- */

  /** 弹窗渲染源：等待确认的工具调用（SSE 事件或断连恢复快照） */
  const pendingInteraction = computed(() => chat.pendingInteraction.value)
  /** 服务端终验失败的逐字段错误（提交失败后回写弹窗） */
  const interactionError = ref('')

  // 断连恢复：线程详情带有等待中的确认快照（页面刷新/重连）→ 重建弹窗
  watch(
    () => threads.pendingInteraction.value,
    (snapshot) => {
      if (snapshot) {
        chat.restoreInteraction(snapshot)
      }
    },
  )

  async function onSubmitInteraction(args: Record<string, unknown>): Promise<void> {
    interactionError.value = ''
    const result = await chat.submitInteraction(args)
    if (!result.close && result.message) {
      interactionError.value = result.message
    }
  }

  function onRejectInteraction(): void {
    interactionError.value = ''
    void chat.rejectInteraction()
  }

  /* ---------- 发送与回合（US1 / US2） ---------- */

  /**
   * 发起一轮对话（**唯一**发送链路：输入区、问题实例、下一步动作卡片、失败轮「重试本轮」
   * 都走它）。
   *
   * @param options.settleBeforeReturn 默认 `false`→`undefined`：等本轮**结束**才返回（历史刷新、
   *   失败还原草稿都依赖这一等待）。传 `false` 时**本地校验一过、请求一发出即返回**——
   *   给"点卡片确认"用：弹窗要立刻关，不能陪着这一轮输出一起等（否则用户会看到
   *   "点了确认、弹窗却一直挂着直到答完才消失"）。
   *
   * @returns 是否真的发出：`false` = 在本地被拦下（正文为空 / 引用失效 / 会话建不出来 / 发送失败）。
   *   调用方据此决定后续动作——例如卡片的确认弹窗**只有真发出去了才关闭**，否则保留内容让用户重试。
   */
  async function onSend(
    payload: {
      content: string
      attachments: FileReference[]
      /** 本轮隐藏指引（004）；由问题实例与下一步动作卡片携带，用户气泡里看不到 */
      guidance?: string
      /** 013：预置动作入口携带——本轮跳过意图聚焦（服务端可校验） */
      skipIntentFocus?: boolean
    },
    options: { settleBeforeReturn?: boolean } = {},
  ): Promise<boolean> {
    // 正在等 MCP 就绪：直接忽略重复点击（否则会排队发两轮）
    if (mcpReady.preparing.value) return false

    // 展示层 → 提交层：正文去掉 `@文件名` 标记，引用以结构化 `attachments` 提交（FR-016）
    const content = stripMentionTokens(payload.content, payload.attachments)
    if (content === '') {
      toast.push('error', '请输入消息内容')
      return false
    }

    // 发送前校验引用仍存在，不存在则提示且不发送（FR-018 / V-15）
    const missing = payload.attachments.filter((reference) => !workspace.exists(reference))
    if (missing.length > 0) {
      toast.push('error', `引用的文件已不存在：${missing.map((item) => item.filename).join('、')}`)
      return false
    }

    if (!threads.activeId.value) {
      await threads.create()
      if (!threads.activeId.value) {
        // 未选定数字人等情况下创建失败：保留输入，不发起请求（提示由 useThreads 负责）
        return false
      }
    }

    // MCP 就绪门（2026-10-18）：仍有灰色 → 先唤醒并等出连接结果，再提交。
    // 放在 `chat.send` 之前、草稿清空之前：等待期间用户仍能看到自己的输入。
    await mcpReady.waitMcpReady()

    const previous = payload.content
    chat.draft.value = ''
    /**
     * 007：**发起即清空**上一轮的卡片。
     *
     * 卡片属于"最新一轮"，而这一轮在 `chat.send` 之后就不再是最新了。若等到本轮 `done`
     * 才清掉，用户会看到"点了卡片、旧卡片一直挂着、直到新回答输出完毕才消失"——
     * 既像卡住，也让人以为这轮没产出新卡片。新一轮的卡片由 done 直推写入（`apply`）。
     *
     * 放在 **`chat.send` 之前**：从用户视角"发起"就是这一刻，早于首字节返回。
     * 服务端同样在轮开始就删除快照（`RunManager.startRun` 的 `clear`），两侧同一语义。
     */
    nextSteps.reset()
    const run = chat.send({
      content,
      attachments: payload.attachments,
      ...(payload.guidance ? { guidance: payload.guidance } : {}),
      ...(payload.skipIntentFocus === true ? { skipIntentFocus: true } : {}),
    })
    if (options.settleBeforeReturn === false) {
      // 007：卡片确认——本地校验已过、请求已发出即视为成功，**不等待本轮结束**，
      // 弹窗即刻关闭。`chat.send` 内部永不 reject（错误一律转 phase），故 fire-and-forget 安全；
      // 本轮成败由 chat 自身负责（失败会 toast；卡片正文不进输入框，无需还原草稿）。
      void run
      return true
    }
    await run
    if (chat.phase.value === RUN_PHASE.FAILED) {
      // 发送失败保留输入与引用（data-model §14）
      chat.draft.value = previous
      return false
    }
    mention.reset()
    return true
  }

  function onStop(): void {
    void chat.stop()
  }

  /**
   * 「重新生成」/「重试本轮」（**本轮**缓存路径）：以缓存的上一条用户消息重发。
   * 走 `onSend` 全链路（引用存在性校验、线程创建、失败还原草稿），
   * 缓存内容发前已去除 `@` 标记，`stripMentionTokens` 为空操作。
   *
   * 缓存 `null` 即不可重发（断连/传输层失败：后端那一轮可能仍在跑，重发会撞 409），
   * 此时失败块保留「重新获取」走 `recover()` 重拉历史。
   */
  async function onRegenerate(): Promise<void> {
    const turn = chat.lastRetryableTurn.value
    if (!turn) {
      return
    }
    await onSend({ content: turn.content, attachments: turn.attachments })
  }

  /**
   * 历史失败轮「重试本轮」：重发该轮的用户消息（载荷由 `MessageList` 从历史里解析——
   * 它是唯一知道"失败消息的同轮用户消息是谁"的地方；`lastRetryableTurn` 只覆盖本次会话内
   * 刚中断/失败的那一轮，刷新即空）。
   *
   * **为什么不是 `recover()`**：失败轮在服务端已终局并落盘，重新拉取历史只会拿回同一条
   * 失败记录——按钮会变成"点了没反应"。这里要的是**真正重发**，故复用 `onSend` 全链路。
   *
   * 本轮进行中不响应（与首屏问题卡片同口径）：`onSend` 会先清草稿、清卡片，再被
   * `chat.send` 的并发校验挡下——那会平白丢掉用户正在输入的内容。
   */
  function onRetryTurn(payload: { content: string; attachments: FileReference[] }): void {
    if (sending.value) {
      return
    }
    void onSend(payload)
  }

  /**
   * **面板级**失败块的重试入口（TR-58 分流）：本轮可重发就重发，否则重拉历史。
   *
   * 为什么不是一个模板三元表达式：`@retry="a ? f : g"` 会被编译成语句而非处理器引用，
   * 点下去**什么都不会发生**（与本次修的悬空事件同一类坑）——故分流必须落在函数里。
   *
   * 分流判据就是 `streaming.canRegenerate`（本轮用户消息是否还在缓存里）：
   * 断连/传输层失败的后端那一轮可能仍在跑，重发会撞 409，此时只能先 `recover()` 看结果。
   */
  function onRetryFailedRun(): void {
    if (streaming.value?.canRegenerate) {
      void onRegenerate()
      return
    }
    onRecover()
  }

  /* ---------- 下一步动作卡片（007 · US2；状态机在 `useNextStepPrompt`） ---------- */

  /**
   * 三条拒绝规则、"只有真发出去才关弹窗"的口径都写在该模块头部；
   * 这里只把状态源（`streaming` / 当前数字人）与唯一发送链路（`onSend`）交进去。
   */
  const prompt = useNextStepPrompt({
    streaming,
    currentAgent: agents.currentAgent,
    send: onSend,
    toast,
  })

  function onLoadMore(): void {
    void threads.loadMore()
  }

  /**
   * 工具卡片懒加载外置结果正文（002 特性）。
   *
   * 仅做"装配层转发"：错误不在此处理——卡片按 `code === 'TOOL_RESULT_EXPIRED'`
   * 区分"内容已清理"（降级展示）与其他失败（提示可重试）。
   */
  function onLoadToolResult(callId: string): Promise<ToolCallResult> {
    return threads.toolCallResult(callId)
  }

  function onRecover(): void {
    void chat.recover()
  }

  /** 反馈提交：乐观更新 + 失败回滚由 `useChatStream.submitFeedback` 承担（V-08）。 */
  function onFeedback(payload: { message_id: string; value: FeedbackValue }): void {
    void chat.submitFeedback(payload.message_id, payload.value)
  }

  /* ---------- 输入区工具（US3） ---------- */

  function onToggleThinking(): void {
    chat.setThinking(!chat.thinkingEnabled.value)
  }

  function onSelectModel(model: string): void {
    models.select(model)
  }

  /* ---------- 头部与数字人（US6） ---------- */

  /** 搜索栏开关：搜索状态已在 `useSessionSearch` */
  function onToggleSearch(): void {
    if (search.isOpen.value) {
      search.close()
    } else {
      search.open()
    }
  }

  function onToggleWorkspace(): void {
    // 已停在列表态 → 再点即收起；否则展开并停在列表态（从内容态点也会退回列表）
    if (workspaceOpen.value) {
      preview.close()
      return
    }
    preview.openList()
    // 打开时刷新 9 个目录的文件清单（FR-031）
    void workspace.load()
  }

  /** 搜索关键词受控：高亮与定位由 `useSessionSearch` + 列表共同完成（FR-029/030） */
  function onSearchKeyword(value: string): void {
    search.keyword.value = value
  }

  function onToggleAgent(): void {
    void toggleAgentPanel()
  }

  async function toggleAgentPanel(): Promise<void> {
    const next = !agentPanelOpen.value
    agentPanelOpen.value = next
    if (next) {
      await agents.loadCandidates()
    }
  }

  function onCloseAgentPanel(): void {
    agentPanelOpen.value = false
  }

  /** 切换数字人：成功才收起面板，失败保持展开便于重试（FR-037） */
  async function onSwitchAgent(name: string): Promise<void> {
    await agents.switchTo(name)
    if (agents.currentAgent.value?.agent_name === name) {
      agentPanelOpen.value = false
    }
  }

  /* ---------- 跳转与预览（US7） ---------- */

  /** 外部地址：直接新窗口跳转，**不改动**预览目标（V-10 / FR-045） */
  function onOpenLink(href: string): void {
    preview.openLink(href)
  }

  /** 空间目录文件：进入右侧内联预览（FR-046） */
  function onOpenFile(reference: FileReference): void {
    void preview.openFile(reference)
  }

  /** 跳转入口点击：`kind:'file'` 走文件预览口径，其余异源直跳 / 同源预检后进右侧面板 */
  function onOpenView(item: ViewLinkTarget): void {
    void preview.openView(item)
  }

  function onUpdateDraft(value: string): void {
    chat.draft.value = value
  }

  /** 工具栏发送：正文取输入区文本，附件取当前引用（FR-016）。 */
  function onSendFromToolbar(): void {
    void onSend({ content: chat.draft.value.trim(), attachments: mention.buildAttachments() })
  }

  /* ---------- `@` 引用（US4；输入区接线在 `useMentionComposer`） ---------- */

  /** 文本与引用必须同步的那条不变式写在该模块头部；这里只交出浮层状态与输入区文本。 */
  const mentionComposer = useMentionComposer({ mention, draft: chat.draft })

  /* ---------- 上传面板（US3 / 012） ---------- */

  /**
   * 面板接线整体在 `useUploadPanel`（本文件逼近 500 行门禁，宪章原则二）。
   * 放在 `mentionComposer` 之后：成功回写复用它的 `onPickFile`（唯一入口），
   * 不另写一套 `@` 拼写与上限判断。
   */
  const uploadPanel = useUploadPanel({
    uploads,
    workspace,
    acceptUpload: mentionComposer.onPickFile,
  })
  const { uploadOpen, onToggleUpload, onCloseUpload, onPickFiles, onRetryUpload } = uploadPanel

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
    uploadOpen,
    agentPanelOpen,
    workspaceOpen,
    streaming,
    isFailed,
    errorInfo,
    sending,
    preparing: mcpReady.preparing,
    hasMessages,
    pendingUserMessage,
    pendingInteraction,
    interactionError,
    onSubmitInteraction,
    onRejectInteraction,
    onSend,
    onStop,
    onRegenerate,
    onRetryTurn,
    onRetryFailedRun,
    nextSteps,
    // 卡片确认弹窗的出口（2 个状态 + 3 个动作）全部来自 `useNextStepPrompt`：
    // 展开而非逐条重列，避免"清单两处各维护一份"这种最容易漏的漂移
    ...prompt,
    onLoadMore,
    onLoadToolResult,
    onRecover,
    onFeedback,
    onToggleThinking,
    onSelectModel,
    onToggleUpload,
    onCloseUpload,
    onPickFiles,
    onRetryUpload,
    onToggleSearch,
    onToggleWorkspace,
    onSearchKeyword,
    onToggleAgent,
    onCloseAgentPanel,
    onSwitchAgent,
    onOpenLink,
    onOpenFile,
    onOpenView,
    onUpdateDraft,
    onSendFromToolbar,
    // `@` 引用的 7 个出口来自 `useMentionComposer`（同上：展开而非逐条重列）
    ...mentionComposer,
  }
}
