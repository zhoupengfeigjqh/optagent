<script setup lang="ts">
/**
 * 上传入口面板（T052 + 003 三空间改造）
 *
 * 目录树一律来自 workspace 接口（空间 → 子目录），前端不保留目录常量：
 * - 数据准备：列出 scenario 定义的子目录，仅可选 csv/xlsx
 * - 共享空间 / 临时空间：空间自身即目标目录，支持 csv/xlsx/txt/json/pdf/图片
 * 文件选择的 `accept` 按目标空间的 `upload_extensions` 动态设置。
 *
 * 只用一个隐藏 `<input type="file">`：点击目录时记录目标目录并触发文件选择，
 * `change` 时把 `{ dir, files }` 交给上层（多选由 `useUploads` 逐文件各发一次请求）。
 */
import { computed, ref, watch } from 'vue'

import type { ScenarioField, WorkspaceSpace } from '../../api/types'
import type { UploadedDocument } from '../../composables/useUploads'
import BaseIcon from '../common/BaseIcon.vue'
import UploadItem from './UploadItem.vue'

const props = withDefaults(
  defineProps<{
    /** 是否展开 */
    open?: boolean
    /** 三空间树（workspace 接口下发） */
    spaces?: WorkspaceSpace[]
    /** 上传项（含失败原因与重试） */
    uploads?: UploadedDocument[]
  }>(),
  { open: false, spaces: () => [], uploads: () => [] },
)

const emit = defineEmits<{
  close: []
  pick: [payload: { dir: string; files: FileList }]
  retry: [localId: string]
}>()

const inputRef = ref<HTMLInputElement | null>(null)
/** 本次文件选择的目标目录（相对空间路径） */
const activeDir = ref<string | null>(null)
/** 当前展开字段约束提示的目录（同一时刻最多一个；null 表示全部收起） */
const openHintDir = ref<string | null>(null)

/** 点击「?」切换提示浮层（阻止冒泡，避免触发外层关闭逻辑） */
function toggleHint(dir: string, event: MouseEvent): void {
  event.stopPropagation()
  openHintDir.value = openHintDir.value === dir ? null : dir
}

/** 点击面板其余任意位置收起浮层 */
function onDocumentClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  if (!target?.closest('.upload-menu__hint-btn, .upload-menu__hint-pop')) {
    openHintDir.value = null
  }
}

// 仅在有浮层展开时挂 document 监听（flush: 'pre' 保证本次点击不会误触发关闭）
watch(openHintDir, (open) => {
  if (open) {
    document.addEventListener('click', onDocumentClick)
  } else {
    document.removeEventListener('click', onDocumentClick)
  }
})

/** 当前目标空间允许的文件类型（input accept 用） */
const activeAccept = computed(() => {
  const dir = activeDir.value
  if (!dir) return ''
  const space = props.spaces.find((item) => item.dirs.some((d) => d.dir === dir))
  return space?.upload_extensions.join(',') ?? ''
})

function chooseDir(dir: string): void {
  activeDir.value = dir
  const input = inputRef.value
  if (!input) {
    return
  }
  // 允许重复选择同一文件（否则 change 不再触发）
  input.value = ''
  input.click()
}

function onFileChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const dir = activeDir.value
  const files = input.files
  if (dir !== null && files !== null && files.length > 0) {
    emit('pick', { dir, files })
  }
  input.value = ''
  activeDir.value = null
}

function onRetry(localId: string): void {
  emit('retry', localId)
}

/**
 * 目录字段约束的只读提示（校验在服务端，前端只展示要求，契约 §3.1）：
 * `表头须含：A、B；可选：C(string)、D(integer)`
 */
function fieldHint(fields: readonly ScenarioField[]): string {
  const required = fields.filter((f) => f.required).map((f) => f.name)
  const optional = fields.filter((f) => !f.required).map((f) => `${f.name}(${f.type})`)
  const parts: string[] = []
  if (required.length > 0) parts.push(`表头须含：${required.join('、')}`)
  if (optional.length > 0) parts.push(`可选：${optional.join('、')}`)
  return parts.join('；')
}
</script>

<template>
  <div v-if="open" class="upload-menu">
    <div v-for="space in spaces" :key="space.name" class="upload-menu__space">
      <p class="upload-menu__space-title">
        {{ space.name }}
        <span class="upload-menu__space-exts">{{ space.upload_extensions.join(' ') }}</span>
      </p>
      <ul class="upload-menu__dirs">
        <li v-for="directory in space.dirs" :key="directory.dir" class="upload-menu__dir">
          <div class="upload-menu__dir-row">
            <button type="button" class="upload-menu__dir-button" @click="chooseDir(directory.dir)">
              <BaseIcon name="folder" :size="14" />
              <span class="upload-menu__dir-label">{{ directory.label }}</span>
            </button>
            <button
              v-if="directory.fields.length > 0"
              type="button"
              class="upload-menu__hint-btn"
              :aria-expanded="openHintDir === directory.dir"
              aria-label="查看表头要求"
              @click="toggleHint(directory.dir, $event)"
            >
              ?
            </button>
            <div
              v-if="openHintDir === directory.dir"
              class="upload-menu__hint-pop"
              role="tooltip"
            >
              {{ fieldHint(directory.fields) }}
            </div>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="spaces.length === 0" class="upload-menu__empty">文件空间加载中或尚未配置场景</p>

    <input
      ref="inputRef"
      class="upload-menu__input"
      type="file"
      multiple
      hidden
      :accept="activeAccept"
      @change="onFileChange"
    />

    <ul v-if="uploads.length" class="upload-menu__uploads">
      <UploadItem
        v-for="doc in uploads"
        :key="doc.localId"
        :doc="doc"
        @retry="onRetry(doc.localId)"
      />
    </ul>
  </div>
</template>

<style scoped>
.upload-menu {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.upload-menu__space-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  margin: 0;
  padding: 0 var(--space-2);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

.upload-menu__space-exts {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
}

.upload-menu__dirs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1);
}

.upload-menu__dir {
  display: flex;
  flex-direction: column;
}

.upload-menu__dir-row {
  position: relative;
  display: flex;
  align-items: center;
}

.upload-menu__hint-btn {
  flex: none;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--color-border);
  border-radius: 50%;
  background: transparent;
  color: var(--color-text-muted);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.upload-menu__hint-btn:hover,
.upload-menu__hint-btn[aria-expanded='true'] {
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.upload-menu__hint-pop {
  position: absolute;
  top: calc(100% + 2px);
  left: var(--space-2);
  z-index: 10;
  max-width: min(320px, 90vw);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  box-shadow: var(--shadow-md, 0 4px 12px rgb(0 0 0 / 12%));
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  white-space: normal;
  word-break: break-all;
}

.upload-menu__dir-button {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--font-size-sm);
  text-align: left;
  cursor: pointer;
}

.upload-menu__dir-button:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.upload-menu__empty {
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.upload-menu__uploads {
  /* 限高约 3 条，超出可纵向滚动（失败项含错误文案会更高，故按常规 3 行预留） */
  max-height: 6.5rem;
  overflow-y: auto;
  border-top: 1px solid var(--color-border);
  padding-top: var(--space-1);
}
</style>
