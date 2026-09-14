<script setup lang="ts">
/**
 * 右侧工作空间面板（US8 / FR-002、FR-031、FR-046~FR-048）
 *
 * **单区域双视图**：右侧 1/3 只有这一个面板，内部在「文件空间列表」与「文件内容」之间互换，
 * 两者不并存、不叠加——避免"文件空间"和"内容预览"各占一块互相挤宽。
 * - `view='list'` → `WorkspaceSpaceTree`（三空间分层，默认全部收起）
 * - `view='content'` → 内联预览（text / pdf / 回退下载 / 错误态，渲染口径与 US7 一致）
 *
 * 破坏性动作只有删除：本组件负责**二次确认**，确认后才向父级上报 `remove`（不自行发请求）。
 */
import { computed, ref } from 'vue'

import type { ErrorInfo, FileReference, WorkspaceSpace } from '../../api/types'
import type { PanelView, PreviewContent, PreviewTarget } from '../../composables/usePreview'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import LoadingDots from '../common/LoadingDots.vue'
import WorkspaceSpaceTree from './WorkspaceSpaceTree.vue'

const props = withDefaults(
  defineProps<{
    /** 当前视图：文件空间列表 / 文件内容 */
    view?: PanelView
    /** 列表态：三空间树（空间 → 数据准备子目录 → 文件） */
    spaces?: WorkspaceSpace[]
    /** 列表态：已展开的空间名 */
    expandedSpaces?: readonly string[]
    /** 列表态：已展开的二级目录 */
    expandedDirs?: readonly string[]
    /** 列表态：加载中 */
    listLoading?: boolean
    /** 内容态：当前预览目标 */
    target?: PreviewTarget
    /** 内容态：加载结果 */
    content?: PreviewContent | null
    /** 内容态：加载中 */
    contentLoading?: boolean
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
  },
)

const emit = defineEmits<{
  /** 收起面板 */
  close: []
  /** 内容态 → 列表态（面板不收起） */
  back: []
  'toggle-space': [name: string]
  'toggle-dir': [dir: string]
  preview: [reference: FileReference]
  download: [reference: FileReference]
  /** 已二次确认的删除 */
  remove: [reference: FileReference]
}>()

const isContent = computed(() => props.view === 'content')

/** 内容态对应的文件引用；列表态为 `null`。 */
const reference = computed<FileReference | null>(() => {
  const current = props.target
  return current.kind === 'file' ? { dir: current.dir, filename: current.filename } : null
})

/** 目录展示名：在空间树中按相对路径取 workspace 下发的 label，回退路径最后一段 */
function dirLabel(dir: string): string {
  for (const space of props.spaces) {
    const hit = space.dirs.find((item) => item.dir === dir)
    if (hit) {
      return hit.label
    }
  }
  return dir.split('/').pop() ?? dir
}

/** 头部主标题：内容态显示文件名，列表态显示面板名。 */
const headerTitle = computed(() => reference.value?.filename ?? '文件空间')

const errorInfo = computed<ErrorInfo>(
  () => props.content?.error ?? { code: 'UNKNOWN', message: '' },
)

/* ---------- 删除：二次确认（FR-031） ---------- */

/** 待确认删除的文件；`null` 表示无待确认项 */
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
</script>

<template>
  <aside class="workspace-panel" aria-label="文件空间">
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

        <BaseButton variant="ghost" size="sm" aria-label="收起文件空间" @click="emit('close')">
          <BaseIcon name="close" :size="16" />
        </BaseButton>
      </div>
    </header>

    <!-- 列表态：三个空间（默认全部收起；数据准备下钻二级子目录） -->
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

    <!-- 内容态：内联预览（V-11 渲染分派） -->
    <div v-else class="workspace-panel__body">
      <LoadingDots v-if="contentLoading" label="正在加载预览" />

      <template v-else-if="content">
        <!-- 文本类：原样展示（CSV / JSON 不做表格化，避免引入解析库）
             插值必须与标签同行：<pre> 保留空白，换行写法会给内容注入缩进 -->
        <pre v-if="content.renderMode === 'text'" class="workspace-panel__text">{{ content.text }}</pre>

        <!-- PDF -->
        <iframe
          v-else-if="content.renderMode === 'pdf'"
          class="workspace-panel__frame"
          :src="content.url ?? ''"
          title="PDF 预览"
        />

        <!-- 图片 -->
        <img
          v-else-if="content.renderMode === 'image'"
          class="workspace-panel__image"
          :src="content.url ?? ''"
          alt="图片预览"
        />

        <!-- 不支持内联预览 / 错误态：统一给下载引导（FR-048） -->
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

  <!-- 删除二次确认：确认后才上报，由父级发请求 -->
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
