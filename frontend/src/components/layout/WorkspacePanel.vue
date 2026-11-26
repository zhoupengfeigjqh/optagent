<script setup lang="ts">
import { computed, ref } from 'vue'

import type { ErrorInfo, FileReference, WorkspaceSpace } from '../../api/types'
import { bindFrameEscape, useMaximizeEscape } from '../../composables/useMaximizeEscape'
import type { PanelView, PreviewContent, PreviewTarget } from '../../composables/usePreview'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import LoadingDots from '../common/LoadingDots.vue'
import SheetPreview from './SheetPreview.vue'
import WorkspaceSpaceTree from './WorkspaceSpaceTree.vue'

const props = withDefaults(
  defineProps<{
    view?: PanelView
    spaces?: WorkspaceSpace[]
    expandedSpaces?: readonly string[]
    expandedDirs?: readonly string[]
    listLoading?: boolean
    target?: PreviewTarget
    content?: PreviewContent | null
    contentLoading?: boolean
    maximizeVisible?: boolean
    maximized?: boolean
  }>(),
  {
    view: 'list',
    spaces: () => [],
    expandedSpaces: () => [],
    expandedDirs: () => [],
    listLoading: false,
    target: () => ({ kind: 'none' }),
    content: null,
    contentLoading: false,
    maximizeVisible: false,
    maximized: false,
  },
)

const emit = defineEmits<{
  close: []
  back: []
  'toggle-space': [name: string]
  'toggle-dir': [dir: string]
  preview: [reference: FileReference]
  download: [reference: FileReference]
  remove: [reference: FileReference]
  'toggle-maximize': []
  'restore-maximize': []
}>()

const isContent = computed(() => props.view === 'content')

const reference = computed<FileReference | null>(() => {
  const current = props.target
  return current.kind === 'file' ? { dir: current.dir, filename: current.filename } : null
})

const urlTarget = computed(() => (props.target.kind === 'url' ? props.target : null))

function dirLabel(dir: string): string {
  for (const space of props.spaces) {
    const hit = space.dirs.find((item) => item.dir === dir)
    if (hit) {
      return hit.label
    }
  }
  return dir.split('/').pop() ?? dir
}

const headerTitle = computed(() => reference.value?.filename ?? urlTarget.value?.name ?? '文件空间')

const errorInfo = computed<ErrorInfo>(
  () => props.content?.error ?? { code: 'UNKNOWN', message: '' },
)


const pendingRemove = ref<FileReference | null>(null)

const removeMessage = computed(() => {
  const target = pendingRemove.value
  if (!target) return ''
  return `删除后该文件不可恢复，确定要删除「${target.filename}」吗？`
})

function requestRemove(reference: FileReference): void {
  pendingRemove.value = reference
}

function onConfirmRemove(): void {
  const target = pendingRemove.value
  if (!target) return
  pendingRemove.value = null
  emit('remove', target)
}

function onDownload(): void {
  const current = reference.value
  if (current !== null) {
    emit('download', current)
  }
}

/**
 * 预检结论为 `download`（响应头声明 `attachment`，或类型不可内联）时的出口。
 *
 * 新窗口交给浏览器自己处理：带 `attachment` 的响应会直接下载，可内联的会正常打开。
 * 前端刻意不自造下载（拿不到文件名与大小，等于猜）。
 */
function onOpenUrl(): void {
  const current = urlTarget.value
  if (current === null || typeof window === 'undefined') {
    return
  }
  window.open(current.url, '_blank', 'noopener,noreferrer')
}

function ensureInnerScroll(doc: Document): void {
  const style = doc.createElement('style')
  style.textContent = 'html,body{overflow:auto !important;}'
  doc.head.appendChild(style)
}

function onFrameLoad(event: Event): void {
  const doc = (event.target as HTMLIFrameElement).contentDocument
  if (doc === null) {
    return
  }
  ensureInnerScroll(doc)
  bindFrameEscape(doc, () => emit('restore-maximize'))
}

useMaximizeEscape({
  active: () => props.maximized,
  onRestore: () => emit('restore-maximize'),
})
</script>

<template>
  <aside
    class="workspace-panel"
    :class="{ 'workspace-panel--maximized': maximized }"
    aria-label="文件空间"
  >
    <header class="workspace-panel__header">
      <div class="workspace-panel__leading">
        <BaseButton
          v-if="isContent"
          variant="ghost"
          size="sm"
          aria-label="返回文件空间"
          @click="emit('back')"
        >
          <BaseIcon name="chevron-left" :size="16" />
        </BaseButton>

        <div class="workspace-panel__title">
          <span class="workspace-panel__name" :class="{ 'workspace-panel__heading': !isContent }">
            {{ headerTitle }}
          </span>
          <span v-if="reference" class="workspace-panel__dir">
            {{ dirLabel(reference.dir) }}
          </span>
        </div>
      </div>

      <div class="workspace-panel__actions">
        <BaseButton
          v-if="isContent && reference"
          variant="ghost"
          size="sm"
          aria-label="下载当前文件"
          @click="onDownload"
        >
          <BaseIcon name="download" :size="16" />
        </BaseButton>

        <BaseButton
          v-if="maximizeVisible"
          variant="ghost"
          size="sm"
          :aria-label="maximized ? '缩小页面' : '放大页面'"
          :aria-pressed="maximized"
          @click="emit('toggle-maximize')"
        >
          <BaseIcon :name="maximized ? 'minimize' : 'maximize'" :size="16" />
        </BaseButton>

        <BaseButton variant="ghost" size="sm" aria-label="收起文件空间" @click="emit('close')">
          <BaseIcon name="close" :size="16" />
        </BaseButton>
      </div>
    </header>

    <div v-if="!isContent" class="workspace-panel__body workspace-panel__body--inset">
      <WorkspaceSpaceTree
        :spaces="spaces"
        :expanded-spaces="expandedSpaces"
        :expanded-dirs="expandedDirs"
        :loading="listLoading"
        @toggle-space="emit('toggle-space', $event)"
        @toggle-dir="emit('toggle-dir', $event)"
        @preview="emit('preview', $event)"
        @download="emit('download', $event)"
        @remove="requestRemove"
      />
    </div>

    <div v-else class="workspace-panel__body">
      <LoadingDots v-if="contentLoading" label="正在加载预览" />

      <template v-else-if="urlTarget">
        <iframe
          v-if="urlTarget.renderMode === 'iframe'"
          class="workspace-panel__frame"
          :src="urlTarget.url"
          :title="urlTarget.name"
          @load="onFrameLoad"
        />

        <div v-else class="workspace-panel__fallback">
          <p class="workspace-panel__hint">该地址不支持内联预览，请在浏览器中打开。</p>
          <BaseButton variant="primary" size="sm" @click="onOpenUrl">打开</BaseButton>
        </div>
      </template>

      <template v-else-if="content">
        <pre v-if="content.renderMode === 'text'" class="workspace-panel__text">{{
          content.text
        }}</pre>

        <SheetPreview
          v-else-if="content.renderMode === 'sheet'"
          class="workspace-panel__sheet"
          :workbook="content.workbook ?? null"
        />

        <iframe
          v-else-if="content.renderMode === 'pdf'"
          class="workspace-panel__frame"
          :src="content.url ?? ''"
          title="PDF 预览"
        />

        <iframe
          v-else-if="content.renderMode === 'html'"
          class="workspace-panel__frame"
          :src="content.url ?? ''"
          title="HTML 预览"
          sandbox=""
          referrerpolicy="no-referrer"
        />

        <img
          v-else-if="content.renderMode === 'image'"
          class="workspace-panel__image"
          :src="content.url ?? ''"
          alt="图片预览"
        />

        <div v-else class="workspace-panel__fallback">
          <p v-if="content.renderMode === 'download'" class="workspace-panel__hint">
            该类型不支持内联预览，请下载后查看。
          </p>
          <ErrorNotice v-else :error="errorInfo" context="preview" :retry-label="null" />

          <BaseButton variant="primary" size="sm" @click="onDownload">下载完整文件</BaseButton>
        </div>
      </template>
    </div>
  </aside>

  <ConfirmDialog
    :open="pendingRemove !== null"
    title="删除文件"
    :message="removeMessage"
    confirm-label="删除"
    danger
    @confirm="onConfirmRemove"
    @cancel="pendingRemove = null"
  />
</template>

<style scoped>
.workspace-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* 放大态标记：铺满视口的定位在 `AppShell` 的预览列上（栅格由它管），
   这里保证面板自身不透底——覆盖层绝不能"漏"出下面两栏（FR-003） */
.workspace-panel--maximized {
  background: var(--color-surface);
}

.workspace-panel__header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.workspace-panel__leading {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.workspace-panel__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.workspace-panel__name {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.workspace-panel__heading {
  font-size: var(--font-size-lg);
}

.workspace-panel__dir {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.workspace-panel__actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

.workspace-panel__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.workspace-panel__body--inset {
  padding: var(--space-2);
}

.workspace-panel__text {
  margin: 0;
  padding: var(--space-4);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-sm);
  line-height: 1.7;
}

.workspace-panel__sheet {
  height: 100%;
}

.workspace-panel__frame {
  width: 100%;
  height: 100%;
  border: none;
}

.workspace-panel__image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  margin: auto;
  display: block;
}

.workspace-panel__fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
}

.workspace-panel__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
