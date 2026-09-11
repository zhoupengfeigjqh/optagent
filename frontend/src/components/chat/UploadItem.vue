<script setup lang="ts">
/**
 * 单文件上传项（T051，FR-011）
 *
 * 四态渲染：`pending` / `uploading` / `success` / `failed`。
 * `failed` 展示 `error` 经 `toUserMessage(error, 'upload')` 映射后的原因并提供「重试」。
 * 展示名一律优先取响应中的 `serverFilename`（后端已追加时间戳，前端不自行拼接）。
 */
import { computed } from 'vue'

import type { UploadedDocument, UploadStatus } from '../../composables/useUploads'
import { toUserMessage } from '../../utils/error-message'
import { formatFileSize } from '../../utils/format'
import BaseIcon from '../common/BaseIcon.vue'

const props = defineProps<{ doc: UploadedDocument }>()

const emit = defineEmits<{ retry: [] }>()

const STATUS_LABEL: Readonly<Record<UploadStatus, string>> = {
  pending: '待上传',
  uploading: '上传中',
  success: '已完成',
  failed: '上传失败',
}

const statusLabel = computed(() => STATUS_LABEL[props.doc.status])
const sizeText = computed(() => formatFileSize(props.doc.size))
const displayName = computed(() => props.doc.serverFilename ?? props.doc.name)
const failureText = computed(() =>
  props.doc.status === 'failed' && props.doc.error
    ? toUserMessage(props.doc.error, 'upload')
    : '',
)
</script>

<template>
  <li class="upload-item" :class="`upload-item--${doc.status}`">
    <BaseIcon name="file" :size="14" />
    <span class="upload-item__name">{{ displayName }}</span>
    <span class="upload-item__size">{{ sizeText }}</span>
    <span class="upload-item__status">{{ statusLabel }}</span>

    <button
      v-if="doc.status === 'failed'"
      type="button"
      class="upload-item__retry"
      @click="emit('retry')"
    >
      重试
    </button>

    <span v-if="failureText" class="upload-item__error">{{ failureText }}</span>
  </li>
</template>

<style scoped>
.upload-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  font-size: var(--font-size-sm);
}

.upload-item__name {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.upload-item__size,
.upload-item__status {
  color: var(--color-text-muted);
}

.upload-item--success .upload-item__status {
  color: var(--color-status-success);
}

.upload-item--failed .upload-item__status,
.upload-item__error {
  color: var(--color-status-error);
}

.upload-item__error {
  flex: 1 1 100%;
  font-size: var(--font-size-xs);
}

.upload-item__retry {
  padding: 0 var(--space-2);
  border: 1px solid currentColor;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-status-error);
  font: inherit;
  font-size: var(--font-size-xs);
  cursor: pointer;
}
</style>
