<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import type {
  Conversation,
  CreateScheduledTaskRequest,
  FileReference,
  UpdateScheduledTaskRequest,
} from '@/api/types'
import ChatPanel from '@/components/chat/ChatPanel.vue'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import ToastHost from '@/components/common/ToastHost.vue'
import AppShell from '@/components/layout/AppShell.vue'
import HistorySidebar from '@/components/layout/HistorySidebar.vue'
import WorkspacePanel from '@/components/layout/WorkspacePanel.vue'
import SchedulePanel from '@/components/schedule/SchedulePanel.vue'

import { useSession } from '@/composables/useAppSession'
import { RUN_PHASE } from '@/constants/events'
import { downloadTextFile } from '@/utils/download'
import { exportFilename } from '@/utils/export-thread'

const session = useSession()

const expanded = computed(
  () => session.threads.messages.value.length > 0 || session.chat.phase.value !== RUN_PHASE.IDLE,
)

/** 有进行中的会话时禁止切换历史项（FR-036）。 */
const busy = computed(
  () => session.chat.phase.value === RUN_PHASE.STREAMING || session.threads.running.value,
)

onMounted(async () => {
  await session.threads.loadList()
  await restoreThread()
  // 离开本视图即断开，重回时重新建连（`start()` 幂等）
  session.schedule.start()
})

onBeforeUnmount(() => {
  session.schedule.stop()
})

async function restoreThread(): Promise<void> {
  const target = session.initialThreadId
  if (!target) {
    return
  }
  const exists = session.threads.list.value.some((item) => item.thread_id === target)
  if (!exists) {
    session.threads.clearActive()
    session.rememberActiveThread(null)
    return
  }
  await session.threads.select(target)
  if (session.threads.error.value !== null) {
    session.threads.clearActive()
    session.rememberActiveThread(null)
  }
}

watch(
  () => session.threads.activeId.value,
  (threadId) => session.rememberActiveThread(threadId),
)

function onSelectThread(threadId: string): void {
  void session.threads.select(threadId)
}

function onCreateThread(): void {
  session.threads.startNew()
}

function onShowMore(): void {
  session.threads.showMore()
}


const pendingRemove = ref<Conversation | null>(null)

const removeMessage = computed(() => {
  const target = pendingRemove.value
  if (!target) return ''
  const interrupting =
    session.threads.activeId.value === target.thread_id &&
    (session.chat.phase.value === RUN_PHASE.STREAMING || session.threads.running.value)
  const warn = interrupting ? '该会话正在生成中，删除会中断本轮回复。\n' : ''
  return `${warn}删除后该会话的消息与临时文件都会被清理，且不可恢复。\n确定要删除「${target.title ?? '新会话'}」吗？`
})

function onRequestRemove(threadId: string): void {
  pendingRemove.value =
    session.threads.list.value.find((item) => item.thread_id === threadId) ?? null
}

async function onConfirmRemove(): Promise<void> {
  const target = pendingRemove.value
  if (!target) return

  // 邻居必须在 remove 之前算好：remove 走乐观更新，会立刻把目标项移出列表。
  const list = session.threads.list.value
  const index = list.findIndex((item) => item.thread_id === target.thread_id)

  const neighbour = list[index + 1] ?? list[index - 1] ?? null
  const wasActive = session.threads.activeId.value === target.thread_id

  pendingRemove.value = null

  const removed = await session.threads.remove(target.thread_id)
  if (!removed) return // 失败已回滚并弹 toast，不切走当前会话

  if (wasActive && neighbour && neighbour.thread_id !== target.thread_id) {
    await session.threads.select(neighbour.thread_id)
  }
}


/** 提交新标题：请求、乐观更新与失败回滚都在 `useThreads.rename` 里，这里只转发 */
function onRenameThread(payload: { threadId: string; title: string }): void {
  void session.threads.rename(payload.threadId, payload.title)
}

/**
 * 导出会话为 Markdown，交给浏览器下载。
 *
 * 为什么**重新全量拉一次**而不是用中栏现成的 `messages`：那只是已加载的一页
 * （"加载更早的消息"没点时前面几十轮根本不在内存里），照着它导出会静默少内容——
 * 而用户拿到的是文件，事后很难发现少了开头。
 */
async function onExportThread(threadId: string): Promise<void> {
  const thread = session.threads.list.value.find((item) => item.thread_id === threadId)
  if (!thread) return
  const markdown = await session.threads.exportMarkdown(threadId)
  if (markdown === null) return
  downloadTextFile(exportFilename(thread), markdown)
}


const panelOpen = computed(() => session.preview.open.value)

function onClosePanel(): void {
  session.preview.close()
}

function onBackToList(): void {
  session.preview.backToList()
}

function onToggleSpace(name: string): void {
  session.workspace.toggleSpace(name)
}

function onToggleDir(dir: string): void {
  session.workspace.toggleDir(dir)
}

function onOpenFile(reference: FileReference): void {
  void session.preview.openFile(reference)
}

function onPanelDownload(reference: FileReference): void {
  session.preview.download(reference)
}

/**
 * 头部入口：放大 ↔ 缩小（011）。
 *
 * 接线而已：状态与判据都在会话态（`usePreview`），本视图不发请求、不推导"能不能放大"。
 */
function onToggleMaximize(): void {
  session.preview.toggleMaximize()
}

function onRestoreMaximize(): void {
  session.preview.restoreMaximize()
}

async function onRemoveFile(reference: FileReference): Promise<void> {
  const removed = await session.workspace.remove(reference)
  if (removed) {
    session.preview.onFileRemoved(reference)
  }
}


function onCreateTask(input: CreateScheduledTaskRequest): Promise<boolean> {
  return session.schedule.create(input)
}

function onRemoveTask(taskId: string): Promise<boolean> {
  return session.schedule.remove(taskId)
}

function onUpdateTask(taskId: string, input: UpdateScheduledTaskRequest): Promise<boolean> {
  return session.schedule.update(taskId, input)
}

function onToggleTask(payload: { taskId: string; enabled: boolean }): void {
  void session.schedule.setEnabled(payload.taskId, payload.enabled)
}

function onLoadRuns(taskId: string | null): void {
  void session.schedule.loadRuns(taskId === null ? {} : { taskId })
}

/** 点运行记录 → 关覆盖层并跳到那次会话；会话已删的行不可点（见 `ScheduleRunsDialog`） */
async function onOpenRunThread(threadId: string): Promise<void> {
  session.schedule.closePanel()
  await session.threads.select(threadId)
}
</script>

<template>
  <AppShell :preview-open="panelOpen" :preview-maximized="session.preview.maximized.value">
    <template #history>
      <HistorySidebar
        :threads="session.threads.list.value"
        :active-id="session.threads.activeId.value"
        :limit="session.threads.limit.value"
        :loading="session.threads.loading.value"
        :busy="busy"
        @select="onSelectThread"
        @create="onCreateThread"
        @more="onShowMore"
        @rename="onRenameThread"
        @export="onExportThread"
        @remove="onRequestRemove"
      />
    </template>

    <template #chat>
      <ChatPanel :expanded="expanded" />
    </template>

    <template #preview>
      <WorkspacePanel
        :view="session.preview.view.value"
        :spaces="session.workspace.spaces.value"
        :expanded-spaces="session.workspace.expandedSpaces.value"
        :expanded-dirs="session.workspace.expandedDirs.value"
        :list-loading="session.workspace.loading.value"
        :target="session.preview.target.value"
        :content="session.preview.content.value"
        :content-loading="session.preview.loading.value"
        :maximize-visible="session.preview.maximizeToggleVisible.value"
        :maximized="session.preview.maximized.value"
        @close="onClosePanel"
        @back="onBackToList"
        @toggle-maximize="onToggleMaximize"
        @restore-maximize="onRestoreMaximize"
        @toggle-space="onToggleSpace"
        @toggle-dir="onToggleDir"
        @preview="onOpenFile"
        @download="onPanelDownload"
        @remove="onRemoveFile"
      />
    </template>
  </AppShell>

  <SchedulePanel
    :open="session.schedule.panelOpen.value"
    :tasks="session.schedule.tasks.value"
    :loading="session.schedule.loading.value"
    :error="session.schedule.error.value"
    :degraded="session.schedule.degraded.value"
    :pending-ids="session.schedule.pendingIds.value"
    :submitting="session.schedule.creating.value"
    :default-thinking="session.chat.thinkingEnabled.value"
    :runs="session.schedule.runs.value"
    :runs-total="session.schedule.runsTotal.value"
    :runs-loading="session.schedule.runsLoading.value"
    :runs-error="session.schedule.runsError.value"
    :create-task="onCreateTask"
    :update-task="onUpdateTask"
    :remove-task="onRemoveTask"
    @close="session.schedule.closePanel"
    @toggle="onToggleTask"
    @reload="session.schedule.load"
    @load-runs="onLoadRuns"
    @open-thread="onOpenRunThread"
  />

  <ToastHost
    :items="session.toast.items.value"
    @dismiss="session.toast.dismiss"
    @action="session.toast.runAction"
  />

  <ConfirmDialog
    :open="pendingRemove !== null"
    title="删除会话"
    :message="removeMessage"
    confirm-label="删除"
    danger
    @confirm="onConfirmRemove"
    @cancel="pendingRemove = null"
  />
</template>
