<script setup lang="ts">
import { computed } from 'vue'

import type { UploadedDocument, UploadStatus } from '../../composables/useUploads'
import { toUserMessage } from '../../utils/error-message'
import { formatBytes } from '../../utils/format'
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
const sizeText = computed(() => formatBytes(props.doc.size))
const displayName = computed(() => props.doc.serverFilename ?? props.doc.name)
const failureText = computed(() =>
  props.doc.status === 'failed' && props.doc.error ? toUserMessage(props.doc.error, 'upload') : '',
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
  white-space: pre-line;
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
