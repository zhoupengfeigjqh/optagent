<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'

import type { AgentStarter } from '../../api/types'
import { useChatPanel } from '../../composables/useChatPanel'
import { canSendContent } from '../../utils/can-send'
import { EMPTY_DATA_HINT_TEXT } from '../../utils/empty-data-hint'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import ScheduleEntryButton from '../schedule/ScheduleEntryButton.vue'
import AgentPanel from './AgentPanel.vue'
import ChatHeader from './ChatHeader.vue'
import ChatHero from './ChatHero.vue'
import Composer from './Composer.vue'
import ComposerToolbar from './ComposerToolbar.vue'
import MentionPicker from './MentionPicker.vue'
import MentionPopup from './MentionPopup.vue'
import InteractionDialog from './InteractionDialog.vue'
import MessageList from './MessageList.vue'
import PlanProgressBar from './PlanProgressBar.vue'
import ProducedBell from './ProducedBell.vue'
import SkillPicker from './SkillPicker.vue'
import SessionSearch from './SessionSearch.vue'
import TermNormalizeDialog from './TermNormalizeDialog.vue'
import UploadHintBubble from './UploadHintBubble.vue'
import UploadMenu from './UploadMenu.vue'

const props = withDefaults(
  defineProps<{
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
  skill,
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
  pendingTerm,
  termSending,
  onUseReplacement,
  onKeepOriginal,
  onLoadMore,
  onFeedback,
  onToggleThinking,
  onSelectModel,
  onToggleUpload,
  onCloseUpload,
  onPickFiles,
  onPasteFiles,
  onRetryUpload,
  onToggleSearch,
  onToggleWorkspace,
  onSearchKeyword,
  onOpenAgentPanel,
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
  onPickSkill,
  onConfirmSkill,
  onSkillKey,
  onRemoveSkill,
  schedule,
} = useChatPanel()

const showList = computed(() => props.expanded || hasMessages.value || streaming.value !== null)

const toolbarCanSend = computed(
  () =>
    canSendContent(chat.draft.value, skill.selected.value, mention.references.value.length) &&
    !sending.value &&
    !preparing.value,
)


const heroWelcome = computed(() => agents.currentAgent.value?.welcome ?? '')

const heroStarters = computed<AgentStarter[]>(() => agents.currentAgent.value?.starters ?? [])

const agentSelected = computed(() => agents.currentAgent.value !== null)

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
    skipIntentFocus: true,
  })
}


function onEscapeKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (document.querySelector('dialog[open]')) return
  if (mention.open.value || skill.open.value || search.isOpen.value) return
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
    <ChatHeader
      :agent="agents.currentAgent.value"
      :mcp-servers="agents.mcpServers.value"
      :search-open="search.isOpen.value"
      :workspace-open="workspaceOpen"
      @toggle-search="onToggleSearch"
      @toggle-workspace="onToggleWorkspace"
      @open-agent="onOpenAgentPanel"
    >
      <template #actions-extra>
        <ScheduleEntryButton
          :open="schedule.panelOpen.value"
          :disabled="!agentSelected"
          disabled-reason="请先选择数字人"
          @open="schedule.openPanel()"
        />
        <ProducedBell @open-view="onOpenView" />
      </template>
    </ChatHeader>

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
        :source="threads.activeSource.value"
        :messages="threads.messages.value"
        :streaming="streaming"
        :pending-user="pendingUserMessage"
        :search-keyword="search.keyword.value"
        :active-match-index="search.activeIndex.value"
        :has-more="threads.hasMore.value"
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

    <ChatHero
      v-else
      :welcome="heroWelcome"
      :starters="heroStarters"
      :agent-selected="agentSelected"
      :busy="streaming !== null"
      @select="onStarterClick"
    />

    <ErrorNotice
      v-if="isFailed && errorInfo"
      class="chat-panel__error"
      :error="errorInfo"
      :hint="degradedAgentHint"
      context="send-message"
      :retry-label="streaming?.canRegenerate ? '重试本轮' : '重新获取'"
      @retry="onRetryFailedRun"
    />

    <!-- 028 FR-034：计划进度条（单行，贴输入区；本轮结束淡出，不进历史） -->
    <PlanProgressBar :items="chat.planProgress.value" :active="sending" />

    <UploadMenu
      class="chat-panel__upload"
      :open="uploadOpen"
      :spaces="workspace.spaces.value"
      :uploads="uploads.items.value"
      @pick="onPickFiles"
      @retry="onRetryUpload"
      @close="onCloseUpload"
    />

    <p v-if="preparing" class="chat-panel__mcp-pending" role="status">正在连接 MCP 服务…</p>

    <Composer
      :model-value="chat.draft.value"
      :sending="sending"
      :disabled="sending || preparing"
      :references="mention.references.value"
      :mention-open="mention.open.value"
      :skill="skill.selected.value"
      :skill-open="skill.open.value"
      @update:model-value="onUpdateDraft"
      @input-text="onInputText"
      @mention-key="onMentionKey"
      @remove-reference="onRemoveReference"
      @skill-key="onSkillKey"
      @remove-skill="onRemoveSkill"
      @paste-files="onPasteFiles"
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

      <template #skill="{ anchor }">
        <MentionPopup
          class="chat-panel__mention"
          :open="skill.open.value"
          :anchor="anchor"
          :caret="skill.caret.value"
          @close="skill.close"
        >
          <SkillPicker
            :open="skill.open.value"
            :skills="skill.filtered.value"
            :active-index="skill.activeIndex.value"
            :loading="skill.loading.value"
            :error="skill.error.value"
            :selected="skill.selected.value"
            @pick="onPickSkill"
            @close="skill.close"
            @move="skill.move"
            @confirm="onConfirmSkill"
          />
        </MentionPopup>
      </template>

      <template #toolbar>
        <ComposerToolbar
          :thinking="chat.thinkingEnabled.value"
          :model="models.current.value"
          :models="models.models.value"
          :can-send="toolbarCanSend"
          :streaming="sending"
          :upload-disabled="sending"
          @toggle-thinking="onToggleThinking"
          @select-model="onSelectModel"
          @send="onSendFromToolbar"
          @stop="onStop"
          @toggle-upload="onToggleUpload"
        >
          <template #upload-hint>
            <UploadHintBubble
              v-if="emptyHint.visible.value"
              :text="EMPTY_DATA_HINT_TEXT"
              @close="emptyHint.dismiss"
            />
          </template>
        </ComposerToolbar>
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

    <InteractionDialog
      v-if="pendingInteraction"
      :request="pendingInteraction"
      :server-error="interactionError"
      @submit="onSubmitInteraction"
      @reject="onRejectInteraction"
    />

    <TermNormalizeDialog
      v-if="pendingTerm"
      :open="true"
      :original="pendingTerm?.original ?? ''"
      :normalized="pendingTerm?.normalized ?? ''"
      :matches="pendingTerm?.matches ?? []"
      :busy="termSending"
      @use-replacement="onUseReplacement"
      @keep-original="onKeepOriginal"
    />

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
  /* 中栏宽度只由栅格轨道决定：不许被子内容的 min-content 反推撑宽。
     否则拖动右侧分隔条时，含代码块 / nowrap 表格的消息会把整列顶在旧宽度上，
     文字不再重排，多出来的部分被 `.app-shell__main` 裁掉（看着像被右栏盖住）。 */
  min-width: 0;
}

.chat-panel__body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
}

.chat-panel__body > * {
  flex: 1;
  min-height: 0;
  /* 横向 flex 项默认 `min-width: auto` = 内容最小宽，必须显式归零才能跟着轨道收缩 */
  min-width: 0;
}

.chat-panel__error {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}

.chat-panel__upload {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
}

.chat-panel__mcp-pending {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.chat-panel__mention {
  flex: none;
  margin: 0;
}
</style>
