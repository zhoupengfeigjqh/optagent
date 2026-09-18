<script setup lang="ts">
/**
 * 聊天区（T042）
 *
 * 中栏容器：头部 + 搜索栏 + 消息列表 + 输入区 + 浮层（上传 / `@` 引用 / 工作空间 / 数字人）。
 * - `expanded=false` 时输入区垂直居中、消息列表不渲染（初始入口，FR-003/FR-004）
 * - 全部接线（事件编排、UI 开关、生命周期）集中在 `useChatPanel()`，
 *   本组件只负责 props 相关的布局派生与渲染（宪章原则二：单文件 ≤500 行）
 */
import { computed } from 'vue'

import { useChatPanel } from '../../composables/useChatPanel'
import ErrorNotice from '../common/ErrorNotice.vue'
import AgentPanel from './AgentPanel.vue'
import ChatHeader from './ChatHeader.vue'
import Composer from './Composer.vue'
import ComposerToolbar from './ComposerToolbar.vue'
import MentionPicker from './MentionPicker.vue'
import InteractionDialog from './InteractionDialog.vue'
import MessageList from './MessageList.vue'
import SessionSearch from './SessionSearch.vue'
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
  hasMessages,
  pendingUserMessage,
  pendingInteraction,
  interactionError,
  onSubmitInteraction,
  onRejectInteraction,
  onSend,
  onStop,
  onRegenerate,
  onLoadMore,
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
} = useChatPanel()

/**
 * 是否渲染消息列表。
 * 除 `expanded` 与历史消息外，本轮已开始（首轮尚未落盘）也应下移入口（FR-004）。
 */
const showList = computed(() => props.expanded || hasMessages.value || streaming.value !== null)
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
    />

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
        :messages="threads.messages.value"
        :streaming="streaming"
        :pending-user="pendingUserMessage"
        :search-keyword="search.keyword.value"
        :active-match-index="search.activeIndex.value"
        :has-more="threads.hasMore.value"
        @load-more="onLoadMore"
        @feedback="onFeedback"
        @regenerate="onRegenerate"
        @open-link="onOpenLink"
        @open-file="onOpenFile"
      />
    </div>

    <div v-else class="chat-panel__hero">
      <h1 class="chat-panel__hero-title">开始新的对话</h1>
      <p class="chat-panel__hero-desc">在下方输入消息，即可开始本轮求解。</p>
    </div>

    <ErrorNotice
      v-if="isFailed && errorInfo"
      class="chat-panel__error"
      :error="errorInfo"
      retry-label="重新获取"
      @retry="onRecover"
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

    <Composer
      :model-value="chat.draft.value"
      :sending="sending"
      :disabled="sending"
      :references="mention.references.value"
      :mention-open="mention.open.value"
      @update:model-value="onUpdateDraft"
      @input-text="onInputText"
      @mention-key="onMentionKey"
      @remove-reference="onRemoveReference"
      @send="onSend"
      @stop="onStop"
    >
      <template #mention>
        <MentionPicker
          class="chat-panel__mention"
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
      </template>

      <template #toolbar>
        <ComposerToolbar
          :thinking="chat.thinkingEnabled.value"
          :model="models.current.value"
          :models="models.models.value"
          :can-send="chat.canSend.value"
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
}

.chat-panel__hero-title {
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.chat-panel__hero-desc {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.chat-panel__error {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}

.chat-panel__upload,
.chat-panel__mention {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}
</style>
