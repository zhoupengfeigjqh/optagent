<script setup lang="ts">
/**
 * 聊天区（T042）
 *
 * 中栏容器：头部 + 搜索栏 + 消息列表 + 输入区 + 浮层（上传 / `@` 引用 / 工作空间 / 数字人）。
 * - `expanded=false` 时输入区垂直居中、消息列表不渲染（初始入口，FR-003/FR-004）
 * - 全部接线（事件编排、UI 开关、生命周期）集中在 `useChatPanel()`，
 *   本组件只负责 props 相关的布局派生与渲染（宪章原则二：单文件 ≤500 行）
 */
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

import type { AgentStarter } from '../../api/types'
import { useChatPanel } from '../../composables/useChatPanel'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import AgentPanel from './AgentPanel.vue'
import ChatHeader from './ChatHeader.vue'
import Composer from './Composer.vue'
import ComposerToolbar from './ComposerToolbar.vue'
import MentionPicker from './MentionPicker.vue'
import MentionPopup from './MentionPopup.vue'
import InteractionDialog from './InteractionDialog.vue'
import MessageList from './MessageList.vue'
import ProducedBell from './ProducedBell.vue'
import SessionSearch from './SessionSearch.vue'
import SuggestionCard from './SuggestionCard.vue'
import UploadMenu from './UploadMenu.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开为完整对话布局 */
    expanded?: boolean
  }>(),
  { expanded: false },
)

const {
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
  preparing,
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
  pendingSuggestion,
  suggestionSending,
  onPickNextStep,
  onCancelSuggestion,
  onConfirmSuggestion,
  onLoadMore,
  onLoadToolResult,
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
  onInputText,
  onPickSpace,
  onPickDir,
  onPickFile,
  onConfirmMention,
  onMentionKey,
  onRemoveReference,
} = useChatPanel()

/**
 * 是否渲染消息列表。
 * 除 `expanded` 与历史消息外，本轮已开始（首轮尚未落盘）也应下移入口（FR-004）。
 */
const showList = computed(() => props.expanded || hasMessages.value || streaming.value !== null)

/* ---------- 首屏引导（004） ---------- */

/** 当前数字人的首屏欢迎语；旧版 SOUL 无结构化数据时为空 → 退回原空状态文案 */
const heroWelcome = computed(() => agents.currentAgent.value?.welcome ?? '')

/** 问题卡片：全部平铺展示，点击即发起一轮对话 */
const heroStarters = computed<AgentStarter[]>(() => agents.currentAgent.value?.starters ?? [])

const agentSelected = computed(() => agents.currentAgent.value !== null)

/**
 * 陈旧的数字人上下文（已被移除/不再对该用户可用）→ 在**既有错误提示位**补一句
 * "现在还能选谁"（009 FR-032/052；不新增控件）。
 *
 * 候选清单可能尚未加载（面板没打开过），此时先触发一次加载；文案在清单到位后自然补全。
 */
const degradedAgentHint = computed(() => {
  if (errorInfo.value?.code !== 'AGENT_NOT_AVAILABLE') return null
  const names = agents.candidates.value.map((item) => item.agent_name)
  return names.length > 0 ? `可切换的数字人：${names.join('、')}` : '请重新选择数字人'
})

watch(
  () => errorInfo.value?.code,
  (code) => {
    if (code === 'AGENT_NOT_AVAILABLE') void agents.loadCandidates()
  },
)

/**
 * 点击问题卡片 = 发起一轮对话。
 *
 * 正文只发问题本身（用户气泡保持干净）；关联工具的引导随 `guidance` 走
 * **请求级隐藏通道**——不落盘、不进历史，只在那一轮的系统提示词里出现。
 * 未选数字人或本轮进行中时不响应（未选数字人的提示由 `threads.create()` 兜底）。
 */
function onStarterClick(starter: AgentStarter): void {
  if (!agentSelected.value || streaming.value !== null) return
  void onSend({
    content: starter.prompt,
    attachments: [],
    ...(starter.guidance ? { guidance: starter.guidance } : {}),
  })
}

/* ---------- Esc：中断本轮（2026-10-16） ---------- */

/**
 * Esc = 点「终止」。按下一律走同一条**优先级瀑布**，顺序错了就是灾难（该关的弹窗没关、
 * 反而把正在输出的回答掐了）：
 *
 * 1. 打开的原生 `<dialog>` → 让路。弹窗的 Esc 语义是"关掉它"（`BaseDialog` 系全部基于
 *    原生 dialog），此时中断本轮属于误伤；
 * 2. `@引用`面板 / 会话内搜索 → 它们各自已有 Esc 处理，这里不重复消费；
 * 3. 本轮正在流式 → 中断（复用 `onStop`，与「终止」按钮同一条链路）；
 * 4. 其余 → 不拦。
 *
 * 监听挂在 `window` 而非输入框上：用户此刻可能正把焦点放在消息列表或右侧预览区，
 * 要求"必须先点回输入框才能停"没有道理（键盘可达性，宪章原则四）。
 */
function onEscapeKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (document.querySelector('dialog[open]')) return
  if (mention.open.value || search.isOpen.value) return
  if (!sending.value) return
  event.preventDefault()
  onStop()
}

onMounted(() => {
  window.addEventListener('keydown', onEscapeKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onEscapeKey)
})
</script>

<template>
  <section class="chat-panel">
    <!-- 头部：数字人名称 + MCP 状态 + 右上角按钮位（US6） -->
    <ChatHeader
      :agent="agents.currentAgent.value"
      :mcp-servers="agents.mcpServers.value"
      :search-open="search.isOpen.value"
      :workspace-open="workspaceOpen"
      :agent-panel-open="agentPanelOpen"
      @toggle-search="onToggleSearch"
      @toggle-workspace="onToggleWorkspace"
      @toggle-agent="onToggleAgent"
    >
      <!-- 后台产出铃铛（R11）：自带数据与面板，故不走上面对三个按钮的 toggle 通道 -->
      <template #actions-extra>
        <ProducedBell @open-view="onOpenView" />
      </template>
    </ChatHeader>

    <!-- 会话内搜索栏（US8）：命中高亮由 MessageContent 经 segments 统一渲染 -->
    <SessionSearch
      :open="search.isOpen.value"
      :keyword="search.keyword.value"
      :total="search.total.value"
      :active-index="search.activeIndex.value"
      @update:keyword="onSearchKeyword"
      @next="search.next"
      @close="search.close"
    />

    <div v-if="showList" class="chat-panel__body">
      <MessageList
        :thread-id="threads.activeId.value"
        :messages="threads.messages.value"
        :streaming="streaming"
        :pending-user="pendingUserMessage"
        :search-keyword="search.keyword.value"
        :active-match-index="search.activeIndex.value"
        :has-more="threads.hasMore.value"
        :load-tool-result="onLoadToolResult"
        :next-steps="nextSteps.steps.value"
        @load-more="onLoadMore"
        @feedback="onFeedback"
        @regenerate="onRegenerate"
        @retry="onRetryTurn"
        @send-suggestion="onPickNextStep"
        @open-link="onOpenLink"
        @open-file="onOpenFile"
        @open-view="onOpenView"
      />
    </div>

    <div v-else class="chat-panel__hero">
      <div class="chat-panel__hero-inner">
        <h1 class="chat-panel__hero-title">{{ heroWelcome || '开始新的对话' }}</h1>
        <p v-if="!agentSelected" class="chat-panel__hero-desc">
          请先选择数字人，再使用下方的问题快速开始。
        </p>
        <p v-else-if="heroStarters.length === 0" class="chat-panel__hero-desc">
          在下方输入消息，即可开始本轮求解。
        </p>

        <ul v-if="heroStarters.length > 0" class="chat-panel__starters">
          <li v-for="(starter, index) in heroStarters" :key="index">
            <!-- 与回答下方的下一步动作卡片**同一枚卡片**（FR-012）：两处必须同源同形，
                 否则就是引入了第二套视觉体系。关联工具不在此展示（它只用于生成隐藏引导，
                 `exposed_name` 亦是内部实现细节，对业务用户无意义） -->
            <SuggestionCard
              :text="starter.prompt"
              :disabled="!agentSelected || streaming !== null"
              :data-test="`chat-starter-${index}`"
              @select="onStarterClick(starter)"
            />
          </li>
        </ul>
      </div>
    </div>

    <!--
      本轮失败提示（TR-58 分流）：本轮用户消息还在缓存里（服务端已终局）→「重试本轮」真正重发；
      缓存不可用（断连/传输层失败：后端那一轮可能仍在跑）→ 保持「重新获取」重拉历史。
      分流的**判断**在 `onRetryFailedRun` 里——模板里不能写 `@retry="a ? f : g"`（编译成语句，点了没反应）
    -->
    <ErrorNotice
      v-if="isFailed && errorInfo"
      class="chat-panel__error"
      :error="errorInfo"
      :hint="degradedAgentHint"
      context="send-message"
      :retry-label="streaming?.canRegenerate ? '重试本轮' : '重新获取'"
      @retry="onRetryFailedRun"
    />

    <!-- 加号上传入口：目录树一律取自 workspace 接口（三空间，scenario 定义子目录） -->
    <UploadMenu
      class="chat-panel__upload"
      :open="uploadOpen"
      :spaces="workspace.spaces.value"
      :uploads="uploads.items.value"
      @pick="onPickFiles"
      @retry="onRetryUpload"
      @close="onCloseUpload"
    />

    <!-- 发送前的 MCP 就绪等待（2026-10-18）：必须可见，否则"点了没反应"会被当成卡死 -->
    <p v-if="preparing" class="chat-panel__mcp-pending" role="status">正在连接 MCP 服务…</p>

    <Composer
      :model-value="chat.draft.value"
      :sending="sending"
      :disabled="sending || preparing"
      :references="mention.references.value"
      :mention-open="mention.open.value"
      @update:model-value="onUpdateDraft"
      @input-text="onInputText"
      @mention-key="onMentionKey"
      @remove-reference="onRemoveReference"
      @send="onSend"
      @stop="onStop"
    >
      <template #mention="{ anchor }">
        <MentionPopup
          class="chat-panel__mention"
          :open="mention.open.value"
          :anchor="anchor"
          :caret="mention.caret.value"
          @close="mention.close"
        >
          <MentionPicker
            :open="mention.open.value"
            :spaces="mention.spaces.value"
            :column="mention.column.value"
            :active-space="mention.activeSpace.value"
            :active-dir="mention.activeDir.value"
            :dirs="mention.dirs.value"
            :files="mention.files.value"
            :active-index="mention.activeIndex.value"
            :loading="workspace.loading.value"
            @pick-space="onPickSpace"
            @pick-dir="onPickDir"
            @pick-file="onPickFile"
            @close="mention.close"
            @move="mention.move"
            @confirm="onConfirmMention"
            @back="mention.back"
          />
        </MentionPopup>
      </template>

      <template #toolbar>
        <ComposerToolbar
          :thinking="chat.thinkingEnabled.value"
          :model="models.current.value"
          :models="models.models.value"
          :can-send="chat.canSend.value && !preparing"
          :streaming="sending"
          :upload-disabled="sending"
          @toggle-thinking="onToggleThinking"
          @select-model="onSelectModel"
          @send="onSendFromToolbar"
          @stop="onStop"
          @toggle-upload="onToggleUpload"
        />
      </template>
    </Composer>

    <AgentPanel
      :open="agentPanelOpen"
      :current="agents.currentAgent.value"
      :candidates="agents.candidates.value"
      :switching-disabled="agents.switchingDisabled.value"
      :switching-disabled-reason="agents.switchingDisabledReason.value"
      :busy="agents.switching.value"
      @close="onCloseAgentPanel"
      @switch="onSwitchAgent"
    />

    <!-- HITL：工具调用人工确认（Schema 驱动通用表单，与服务解耦） -->
    <InteractionDialog
      v-if="pendingInteraction"
      :request="pendingInteraction"
      :server-error="interactionError"
      @submit="onSubmitInteraction"
      @reject="onRejectInteraction"
    />

    <!-- 007 US2：点卡片先经二次确认（正文为提示词全文），确认后才经既有链路发送 -->
    <ConfirmDialog
      :open="pendingSuggestion !== null"
      title="发送下一步动作"
      :message="pendingSuggestion?.prompt ?? ''"
      confirm-label="发送"
      :busy="suggestionSending"
      @confirm="onConfirmSuggestion"
      @cancel="onCancelSuggestion"
    />
  </section>
</template>

<style scoped>
.chat-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chat-panel__body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.chat-panel__body > * {
  flex: 1;
  min-height: 0;
}

.chat-panel__hero {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  text-align: center;
  padding: var(--space-4);
  /* 问题实例全部平铺，可能很多：超出时整块滚动，不挤压输入区 */
  overflow-y: auto;
}

.chat-panel__hero-inner {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
}

.chat-panel__hero-title {
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.chat-panel__hero-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 卡片本体（`.suggestion-card`）由 `SuggestionCard.vue` 自带：首屏与回答下方共用同一枚卡片，
   样式也必须在同一处（FR-012），故这里只留栅格 */
.chat-panel__starters {
  width: 100%;
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  /* 首屏**多列紧凑**（2026-10-12 产品口径）：一行可放多张、按内容自动铺满整行，
     纵向高度随列数成比例下降。与回答下方的下一步动作卡片（单列）**刻意不同**——
     两处共用同一枚卡片（FR-012），但栅格各自定义 */
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: var(--space-2);
}

.chat-panel__error {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}

.chat-panel__upload {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}

/* 发送前等待 MCP 连接结果：贴近输入区、不抢视觉焦点（文字即状态，不只靠颜色） */
.chat-panel__mcp-pending {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* `@` 面板是 `fixed` 浮层（见 MentionPopup）：坐标由脚本写死，任何 margin
   都会把它从光标处推走，故这里显式清零；也不再参与流内排版。 */
.chat-panel__mention {
  flex: none;
  margin: 0;
}
</style>
