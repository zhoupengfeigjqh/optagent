<script setup lang="ts">
/**
 * 应用根组件（T033 / T042 / T062）
 *
 * 装配全局会话上下文（`useAppSession` 内部 `provide`）并渲染三栏骨架：
 * 左栏历史会话（US5）、中栏聊天区（US1）；右栏为**工作空间面板**（US7 / US8）——
 * 文件空间列表与文件内容在该面板内互换，二者不并存，故只有一个右栏组件。
 */
import { computed, onMounted, ref } from 'vue'

import type { Conversation, FileReference } from './api/types'
import ChatPanel from './components/chat/ChatPanel.vue'
import ConfirmDialog from './components/common/ConfirmDialog.vue'
import ToastHost from './components/common/ToastHost.vue'
import AppShell from './components/layout/AppShell.vue'
import HistorySidebar from './components/layout/HistorySidebar.vue'
import WorkspacePanel from './components/layout/WorkspacePanel.vue'
import { useAppSession } from './composables/useAppSession'
import { RUN_PHASE } from './constants/events'

const session = useAppSession()

/** 有历史消息或本轮已开始 → 展开为完整对话布局（FR-003 / FR-004）。 */
const expanded = computed(
  () =>
    session.threads.messages.value.length > 0 || session.chat.phase.value !== RUN_PHASE.IDLE,
)

/** 有进行中的会话时禁止切换历史项（FR-036）。 */
const busy = computed(
  () => session.chat.phase.value === RUN_PHASE.STREAMING || session.threads.running.value,
)

// 首屏拉取历史会话：一次性拉全量，10 / 100 条切在前端完成（V-09）
onMounted(() => {
  void session.threads.loadList()
})

function onSelectThread(threadId: string): void {
  void session.threads.select(threadId)
}

function onCreateThread(): void {
  void session.threads.create()
}

function onShowMore(): void {
  session.threads.showMore()
}

/* ---------- 删除历史会话（二次确认 + 切相邻会话） ---------- */

/** 待确认删除的会话；`null` 表示无待确认项 */
const pendingRemove = ref<Conversation | null>(null)

/** 二次确认文案：进行中的会话额外提示"会中断本轮"（`data-model.md` §自检规则） */
const removeMessage = computed(() => {
  const target = pendingRemove.value
  if (!target) return ''
  const interrupting =
    session.threads.activeId.value === target.thread_id &&
    (session.chat.phase.value === RUN_PHASE.STREAMING || session.threads.running.value)
  const warn = interrupting ? '该会话正在生成中，删除会中断本轮回复。\n' : ''
  return `${warn}删除后该会话的消息与临时文件都会被清理，且不可恢复。\n确定要删除「${target.title ?? '新会话'}」吗？`
})

/** 点击行内删除入口：先弹确认，不直接发请求 */
function onRequestRemove(threadId: string): void {
  pendingRemove.value =
    session.threads.list.value.find((item) => item.thread_id === threadId) ?? null
}

async function onConfirmRemove(): Promise<void> {
  const target = pendingRemove.value
  if (!target) return

  // 契约 §3.5：删除成功后「切换到相邻会话或空态」——优先下一条，其次上一条。
  // 邻居必须在 remove 之前算好：remove 走乐观更新，会立刻把目标项移出列表。
  const list = session.threads.list.value
  const index = list.findIndex((item) => item.thread_id === target.thread_id)
  const neighbour = list[index + 1] ?? list[index - 1] ?? null
  const wasActive = session.threads.activeId.value === target.thread_id

  // 先关弹窗：删除本身是乐观更新，界面立即响应，不再等后面的请求回来
  pendingRemove.value = null

  const removed = await session.threads.remove(target.thread_id)
  if (!removed) return // 失败已回滚并弹 toast，不切走当前会话

  if (wasActive && neighbour && neighbour.thread_id !== target.thread_id) {
    await session.threads.select(neighbour.thread_id)
  }
}

/* ---------- 右栏工作空间面板（US7 / US8） ---------- */

/** 面板展开即占位右侧 1/3（FR-001）；收起时中栏恢复满宽（FR-002）。 */
const panelOpen = computed(() => session.preview.open.value)

function onClosePanel(): void {
  session.preview.close()
}

/** 内容态 → 列表态（面板保持展开） */
function onBackToList(): void {
  session.preview.backToList()
}

function onToggleSpace(name: string): void {
  session.workspace.toggleSpace(name)
}

function onToggleDir(dir: string): void {
  session.workspace.toggleDir(dir)
}

/** 面板内点文件名、消息内点文件引用走**同一入口**：都进内容态（FR-046） */
function onOpenFile(reference: FileReference): void {
  void session.preview.openFile(reference)
}

function onPanelDownload(reference: FileReference): void {
  session.preview.download(reference)
}

/** 删除文件：成功后若正看着它则收敛回列表态；失败已由 toast 提示，界面保持现状 */
async function onRemoveFile(reference: FileReference): Promise<void> {
  const removed = await session.workspace.remove(reference)
  if (removed) {
    session.preview.onFileRemoved(reference)
  }
}
</script>

<template>
  <AppShell :preview-open="panelOpen">
    <!-- 左栏：历史会话（US5） -->
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
        @remove="onRequestRemove"
      />
    </template>

    <!-- 中栏：聊天区 -->
    <template #chat>
      <ChatPanel :expanded="expanded" />
    </template>

    <!-- 右栏：工作空间面板（列表态 / 内容态，US7 + US8） -->
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
        @close="onClosePanel"
        @back="onBackToList"
        @toggle-space="onToggleSpace"
        @toggle-dir="onToggleDir"
        @preview="onOpenFile"
        @download="onPanelDownload"
        @remove="onRemoveFile"
      />
    </template>
  </AppShell>

  <ToastHost
    :items="session.toast.items.value"
    @dismiss="session.toast.dismiss"
    @action="session.toast.runAction"
  />

  <!-- 删除会话的二次确认（§3.5）：确认后才真正发 DELETE -->
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
