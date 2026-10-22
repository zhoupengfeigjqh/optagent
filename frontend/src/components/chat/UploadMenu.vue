<script setup lang="ts">
/**
 * 上传入口面板（T052 + 003 三空间改造）
 *
 * 目录树一律来自 workspace 接口（空间 → 子目录），前端不保留目录常量：
 * - 数据准备：列出 scenario 定义的子目录，允许类型按**目录**配置（缺省 csv/xlsx）
 * - 共享空间 / 临时空间：空间自身即目标目录，支持 csv/xlsx/txt/json/pdf/图片
 * 文件选择的 `accept` 按**目标目录**自身的 `upload_extensions` 动态设置
 * （与 `useWorkspace.uploadExtensionsOf` 共用同一实现 `uploadExtensionsOfDir`，MUST NOT 自行反查空间级）。
 *
 * 只用一个隐藏 `<input type="file">`：点击目录时记录目标目录并触发文件选择，
 * `change` 时把 `{ dir, files }` 交给上层（多选由 `useUploads` 逐文件各发一次请求）。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { ScenarioField, WorkspaceSpace } from '../../api/types'
import type { UploadedDocument } from '../../composables/useUploads'
import { uploadExtensionsOfDir } from '../../composables/useWorkspace'
import BaseButton from '../common/BaseButton.vue'
import BaseIcon from '../common/BaseIcon.vue'
import HintTip from '../common/HintTip.vue'
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

/**
 * 当前目标**目录**允许的文件类型（input accept 用）。
 *
 * 2026-10-13：粒度下放到目录级 —— 与 `useWorkspace.uploadExtensionsOf` 共用同一实现
 * （`uploadExtensionsOfDir`），删除原先的"按空间反查"（那会让同空间两个白名单不同的
 * 数据准备目录呈现相同的过滤范围，属失败判据 2）。
 */
const activeAccept = computed(() => {
  const dir = activeDir.value
  if (!dir) return ''
  return uploadExtensionsOfDir(
    props.spaces.flatMap((space) => space.dirs),
    dir,
  ).join(',')
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
 * Esc 关闭面板（2026-10-22），与 `useMaximizeEscape` 同范式：
 *
 * - **只在展开期间**在 `window` 上挂监听，用**捕获阶段**先于中栏冒泡阶段的
 *   "Esc 中断本轮回答"执行；命中后 `preventDefault` + `stopPropagation`，
 *   避免用户只想关面板却顺手掐掉正在输出的回答；
 * - 有打开的 `<dialog>`（HITL、确认框等）时一律放行 —— 弹窗的原生 Esc 语义优先，
 *   否则会出现"弹窗还开着、面板先关了"（判据与 `useMaximizeEscape` 一致）。
 *
 * 收起即摘除监听，所以面板没开时 Esc 行为**零变化**。
 */
function onEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  if (document.querySelector('dialog[open]') !== null) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

let escapeAttached = false

function attachEscape(): void {
  if (escapeAttached || typeof window === 'undefined') return
  window.addEventListener('keydown', onEscape, true)
  escapeAttached = true
}

function detachEscape(): void {
  if (!escapeAttached || typeof window === 'undefined') return
  window.removeEventListener('keydown', onEscape, true)
  escapeAttached = false
}

// `immediate`：首帧即展开（如路由恢复）时也要挂上，而不是等下一次开关
watch(
  () => props.open,
  (open) => (open ? attachEscape() : detachEscape()),
  { immediate: true },
)

onBeforeUnmount(detachEscape)

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
    <!--
      独立关闭入口（2026-10-22）：本面板内联在输入区上方、无遮罩，此前只能再次点「+」收起。
      现在有「×」与 Esc 两条显式路径（`close` 上层已接 `onCloseUpload` → 收起并清空终态记录），
      标题让"这是哪个面板"可见。
    -->
    <header class="upload-menu__header">
      <p class="upload-menu__title">上传文件</p>
      <BaseButton
        class="upload-menu__close"
        variant="ghost"
        size="sm"
        aria-label="关闭上传面板"
        title="关闭上传面板（Esc）"
        @click="emit('close')"
      >
        <BaseIcon name="close" :size="14" />
      </BaseButton>
    </header>

    <div v-for="space in spaces" :key="space.name" class="upload-menu__space">
      <p class="upload-menu__space-title">{{ space.name }}</p>
      <ul class="upload-menu__dirs">
        <li v-for="directory in space.dirs" :key="directory.dir" class="upload-menu__dir">
          <div class="upload-menu__dir-row">
            <button type="button" class="upload-menu__dir-button" @click="chooseDir(directory.dir)">
              <BaseIcon name="folder" :size="14" />
              <span class="upload-menu__dir-label">{{ directory.label }}</span>
            </button>
            <!-- 表头要求收进「?」：默认不占版面（与 HITL 弹窗共用同一组件） -->
            <HintTip
              v-if="directory.fields.length > 0"
              :text="fieldHint(directory.fields)"
              label="查看表头要求"
            />
            <!--
              可上传类型挂在**二级目录**行内、紧跟「?」（2026-10-13 粒度下放到目录）：
              数据准备各二级目录可各不相同，空间级的值只是平台默认，展示它会误导
              （与 `accept`、服务端校验三者同源：`directory.upload_extensions`）。
              长清单（共享/临时空间 13 项）在格子内自然折行。
            -->
            <span
              class="upload-menu__dir-exts"
              :class="{ 'upload-menu__dir-exts--after-hint': directory.fields.length > 0 }"
              >{{ directory.upload_extensions.join(' ') }}</span
            >
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

/* 标题与「×」同一行：左侧对齐空间标题的内缩（`--space-2`），右侧「×」收到面板边缘 */
.upload-menu__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-left: var(--space-2);
}

.upload-menu__title {
  margin: 0;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  font-weight: 600;
}

/* BaseButton 的 sm 尺寸带左右 12px 内边距，这里收成方形，避免「×」被撑成大按钮 */
.upload-menu__close {
  padding: var(--space-1);
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

.upload-menu__dirs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-1);
}

.upload-menu__dir {
  display: flex;
  flex-direction: column;
}

/*
 * 目录级可上传类型：与「?」/目录名同一条 flex 行，紧跟其后。
 * - `min-width: 0` 允许它在格子内收缩并**自身折行**（共享/临时空间 13 项），
 *   从而首段类型紧贴名字右侧，不会整段掉到下一行；
 * - 左侧不给 padding（默认 0）：无「?」时（共享/临时空间）直接贴住文件名右侧，
 *   仅当「?」在其前面时才留 4px 气口（见下一条规则）。
 */
.upload-menu__dir-exts {
  min-width: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: 1.4;
  word-break: break-word;
}

/* 类型前面有「?」→ 留 4px 气口；无「?」（共享/临时空间）→ 紧贴文件名右侧 */
.upload-menu__dir-exts--after-hint {
  padding-left: var(--space-1);
}

.upload-menu__dir-row {
  display: flex;
  align-items: center;
  /*
   * 不设 `flex-wrap`：目录名 +「?」+ 类型始终在**同一条 flex 行**上，
   * 类型过长时在自身盒内折行（`min-width: 0`），从而第一段类型紧贴名字右侧，
   * 而不会整段被挤到下一行（那会让「共享空间」这种无「?」的目录看起来是两段）。
   */
}

/*
 * 目录按钮**不撑满整格**（`width: auto`）：紧随其后的「?」才会贴在目录名右侧
 * （如「生产计划?」），而不是被挤到三列网格的最右端。
 * 右侧 padding 收到 `--space-1` 是为了让「?」与名字读起来是连在一起的整体。
 */
.upload-menu__dir-button {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-2);
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
