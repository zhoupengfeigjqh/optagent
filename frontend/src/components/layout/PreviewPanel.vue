<script setup lang="ts">
/**
 * 右侧预览面板（T071，FR-046 / FR-047 / FR-048）
 *
 * 纯展示：目标、内容与加载态均由 `usePreview` 经 props 注入。
 * - `target.kind === 'none'` → 占位态
 * - `renderMode === 'text'` → `<pre>`（`.txt` / `.csv` / `.json`）
 * - `renderMode === 'pdf'` → `<iframe>`（同源直链）
 * - `renderMode === 'download'` → "该类型不支持内联预览" + 下载按钮（`.xlsx` 回退，V-11）
 * - `renderMode === 'error'` → 错误文案（预览语境）+ 下载引导（413 / 404，FR-048）
 */
import { computed } from 'vue'

import type { ErrorInfo, FileReference } from '../../api/types'
import { directoryLabel } from '../../constants/directories'
import type { PreviewContent, PreviewTarget } from '../../composables/usePreview'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import EmptyState from '../common/EmptyState.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import LoadingDots from '../common/LoadingDots.vue'

const props = withDefaults(
  defineProps<{
    /** 当前预览目标 */
    target?: PreviewTarget
    /** 加载结果 */
    content?: PreviewContent | null
    /** 是否加载中 */
    loading?: boolean
  }>(),
  {
    target: () => ({ kind: 'none' }),
    content: null,
    loading: false,
  },
)

const emit = defineEmits<{
  close: []
  download: [reference: FileReference]
}>()

/** 当前目标对应的文件引用；`kind='none'` 时为 `null`。 */
const reference = computed<FileReference | null>(() => {
  const current = props.target
  return current.kind === 'file' ? { dir: current.dir, filename: current.filename } : null
})

const renderMode = computed(() => props.content?.renderMode ?? null)
const errorInfo = computed<ErrorInfo>(
  () => props.content?.error ?? { code: 'UNKNOWN', message: '' },
)

function onDownload(): void {
  const current = reference.value
  if (current !== null) {
    emit('download', current)
  }
}
</script>

<template>
  <aside class="preview-panel" aria-label="内容预览">
    <header v-if="reference" class="preview-panel__header">
      <div class="preview-panel__title">
        <span class="preview-panel__filename">{{ reference.filename }}</span>
        <span class="preview-panel__dir">{{ directoryLabel(reference.dir) }}</span>
      </div>
      <BaseButton variant="ghost" size="sm" aria-label="收起预览" @click="emit('close')">
        <BaseIcon name="close" :size="16" />
      </BaseButton>
    </header>

    <!-- 占位态 -->
    <EmptyState
      v-if="reference === null"
      title="未选择预览内容"
      description="点击消息中的空间目录文件即可在此内联预览"
    />

    <LoadingDots v-else-if="loading" label="正在加载预览" />

    <template v-else-if="content">
      <!-- 文本类：原样展示（CSV / JSON 不做表格化，避免引入解析库） -->
      <pre v-if="renderMode === 'text'" class="preview-panel__text">{{ content.text }}</pre>

      <!-- PDF -->
      <iframe
        v-else-if="renderMode === 'pdf'"
        class="preview-panel__frame"
        :src="content.url ?? ''"
        title="PDF 预览"
      />

      <!-- 不支持内联预览：回退下载（V-11） -->
      <div v-else-if="renderMode === 'download'" class="preview-panel__fallback">
        <p class="preview-panel__hint">该类型不支持内联预览，请下载后查看。</p>
        <BaseButton
          class="preview-panel__download"
          variant="primary"
          size="sm"
          @click="onDownload"
        >
          下载完整文件
        </BaseButton>
      </div>

      <!-- 错误态（413 / 404）：文案 + 下载引导（FR-048） -->
      <div v-else class="preview-panel__fallback">
        <ErrorNotice :error="errorInfo" context="preview" :retry-label="null" />
        <BaseButton
          class="preview-panel__download"
          variant="primary"
          size="sm"
          @click="onDownload"
        >
          下载完整文件
        </BaseButton>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.preview-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.preview-panel__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}

.preview-panel__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.preview-panel__filename {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.preview-panel__dir {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.preview-panel__text {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: var(--space-4);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--font-size-sm);
  line-height: 1.7;
}

.preview-panel__frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: none;
}

.preview-panel__fallback {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
}

.preview-panel__hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
</style>
