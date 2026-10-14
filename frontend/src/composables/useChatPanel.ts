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

import type { AgentStarter, ErrorInfo, FeedbackValue, FileReference, ToolCallResult } from '../api/types'
import { RUN_PHASE } from '../constants/events'
import { nextStepSendPayload } from '../utils/next-steps'
import { useAgents } from './useAgents'
import { useChatStream } from './useChatStream'
import { mentionToken, stripMentionTokens, useFileMention } from './useFileMention'
import { useModels } from './useModels'
import { useNextSteps } from './useNextSteps'
import { usePreview } from './usePreview'
import { useSessionSearch } from './useSessionSearch'
import { useThreads } from './useThreads'
import { useToast } from './useToast'
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
  const agents = useAgents()
  const preview = usePreview()
  const nextSteps = useNextSteps()
  const toast = useToast()

  /** 上传面板展开状态（纯 UI，故留在本层） */
  const uploadOpen = ref(false)
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
      text: chat.streamingText.value,
      thinking: chat.streamingThinking.value,
      toolCalls: chat.toolCalls.value,
      error: chat.error.value,
      // 本轮气泡标注"谁在回答"（009 起会话归属固定，标注用于如实还原存量历史）
      agentName: chat.streamingAgentName.value,
      // 中断轮「重新生成」是否可用：有中断缓存且当前未在流式中
      canRegenerate: phase === RUN_PHASE.ABORTED && chat.lastAbortedTurn.value !== null,
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
   * 发起一轮对话（**唯一**发送链路：输入区、问题实例、下一步动作卡片都走它）。
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
    },
    options: { settleBeforeReturn?: boolean } = {},
  ): Promise<boolean> {
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
   * 中断轮「重新生成」：以缓存的上一条用户消息重发。
   * 走 `onSend` 全链路（引用存在性校验、线程创建、失败还原草稿），
   * 缓存内容发前已去除 `@` 标记，`stripMentionTokens` 为空操作。
   */
  async function onRegenerate(): Promise<void> {
    const turn = chat.lastAbortedTurn.value
    if (!turn) {
      return
    }
    await onSend({ content: turn.content, attachments: turn.attachments })
  }

  /* ---------- 下一步动作卡片（007 · US2） ---------- */

  /** 待确认的卡片（`null` = 弹窗关闭）；点卡片只**打开弹窗**，不发消息 */
  const pendingSuggestion = ref<AgentStarter | null>(null)
  /** 发送进行中：弹窗两个按钮均禁用（连点只发一次） */
  const suggestionSending = ref(false)

  /**
   * 点选卡片 → 打开确认弹窗。
   *
   * 三处不可用态都**拒绝并且不发送**（007 `FR-025` 的可感知口径）：
   * - 本轮进行中：`onSend` 的通道已被占用，此时排队发送会让用户搞不清点了什么；
   * - 未选数字人：明确提示（会话创建也会以 `AGENT_NOT_SELECTED` 兜底）；
   * - 会话已被删除：交给 `onSend` 走既有降级（`threads.create` 失败会 toast 且保留输入）。
   */
  function onPickNextStep(action: AgentStarter): void {
    if (streaming.value !== null) return
    if (agents.currentAgent.value === null) {
      toast.push('error', '请先选择数字人再发送')
      return
    }
    pendingSuggestion.value = action
  }

  function onCancelSuggestion(): void {
    pendingSuggestion.value = null
  }

  /** 确认发送：走**既有** `onSend` 链路（引用校验、建会话、失败还原草稿都在那里） */
  async function onConfirmSuggestion(): Promise<void> {
    const action = pendingSuggestion.value
    if (!action || suggestionSending.value) return
    suggestionSending.value = true
    try {
      // 正文只有提示词；关联工具经 `guidance` 的隐藏通道回传（与问题实例同款）
      const sent = await onSend(nextStepSendPayload(action), { settleBeforeReturn: false })
      // 只有真发出去了才关弹窗：被拦下（会话不可用 / 发送失败）时保留提示词，用户可重试或取消；
      // 一旦发出即关（不等本轮答完）——弹窗不能陪着输出一起挂到结束
      if (sent) pendingSuggestion.value = null
    } finally {
      suggestionSending.value = false
    }
  }

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

  function onToggleUpload(): void {
    const next = !uploadOpen.value
    uploadOpen.value = next
    // 上传入口的目录树取自 workspace 接口（三空间）：展开时若还没有目录就补一次加载，
    // 否则"进页面直接点加号"时目录为空，只会看到兜底文案
    if (next && workspace.spaces.value.length === 0 && !workspace.loading.value) {
      void workspace.load()
    }
  }

  function onCloseUpload(): void {
    uploadOpen.value = false
  }

  function onPickFiles(payload: { dir: string; files: FileList }): void {
    // 扩展名白名单按目标空间下发（workspace 接口），数据准备仅 csv/xlsx
    void uploads.upload(payload.dir, Array.from(payload.files), workspace.uploadExtensionsOf(payload.dir))
  }

  function onRetryUpload(localId: string): void {
    void uploads.retry(localId)
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

  function onUpdateDraft(value: string): void {
    chat.draft.value = value
  }

  /** 工具栏发送：正文取输入区文本，附件取当前引用（FR-016）。 */
  function onSendFromToolbar(): void {
    void onSend({ content: chat.draft.value.trim(), attachments: mention.buildAttachments() })
  }

  /* ---------- `@` 引用（US4） ---------- */

  /** 文本/光标变化：检测 `@` 触发，并同步移除已从正文删除的引用。 */
  function onInputText(payload: { value: string; caret: number }): void {
    mention.handleInput(payload.value, payload.caret)
  }

  function onPickSpace(space: string): void {
    mention.pickSpace(space)
  }

  function onPickDir(dir: string): void {
    mention.pickDir(dir)
  }

  function onPickFile(reference: FileReference): void {
    if (!mention.pickFile(reference)) {
      return
    }
    insertToken(reference)
    mention.close()
  }

  /** Enter/→ 确认当前高亮项：空间/目录列下钻，文件列完成引用。 */
  function onConfirmMention(): void {
    const reference = mention.confirmActive()
    if (reference) {
      onPickFile(reference)
    }
  }

  /** `@` 面板展开时的按键路由（Composer 已拦截并 preventDefault）。 */
  function onMentionKey(key: string): void {
    switch (key) {
      case 'ArrowDown':
        mention.move(1)
        break
      case 'ArrowUp':
        mention.move(-1)
        break
      case 'ArrowRight':
      case 'Enter':
        onConfirmMention()
        break
      case 'ArrowLeft':
        mention.back()
        break
      case 'Escape':
        // 关闭面板但不丢文本（US4 场景 8）
        mention.close()
        break
      default:
        break
    }
  }

  /** 用完整标记替换触发片段（`…@pl` → `…@plan.csv `），便于按标记同步引用。 */
  function insertToken(reference: FileReference): void {
    const replaced = chat.draft.value.replace(/(^|\s)@[^\s@]*$/, '$1')
    chat.draft.value = `${replaced}${mentionToken(reference)} `
  }

  /** 移除引用时同步删除正文中的标记。 */
  function onRemoveReference(reference: FileReference): void {
    mention.remove(reference)
    chat.draft.value = stripMentionTokens(chat.draft.value, [reference])
  }

  return {
    chat,
    threads,
    search,
    models,
    uploads,
    mention,
    workspace,
    agents,
    uploadOpen,
    agentPanelOpen,
    workspaceOpen,
    streaming,
    isFailed,
    errorInfo,
    sending,
    hasMessages,
    pendingUserMessage,
    pendingInteraction,
    interactionError,
    onSubmitInteraction,
    onRejectInteraction,
    onSend,
    onStop,
    onRegenerate,
    nextSteps,
    pendingSuggestion,
    suggestionSending,
    onPickNextStep,
    onCancelSuggestion,
    onConfirmSuggestion,
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
    onUpdateDraft,
    onSendFromToolbar,
    onInputText,
    onPickSpace,
    onPickDir,
    onPickFile,
    onConfirmMention,
    onMentionKey,
    onRemoveReference,
  }
}
