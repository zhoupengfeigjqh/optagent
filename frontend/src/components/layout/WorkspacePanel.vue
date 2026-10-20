<script setup lang="ts">
/**
 * 右侧工作空间面板（US8 / FR-002、FR-031、FR-046~FR-048）
 *
 * **单区域双视图**：右侧 1/3 只有这一个面板，内部在「文件空间列表」与「文件内容」之间互换，
 * 两者不并存、不叠加——避免"文件空间"和"内容预览"各占一块互相挤宽。
 * - `view='list'` → `WorkspaceSpaceTree`（三空间分层，默认全部收起）
 * - `view='content'` → 内联预览（text / pdf / html / 回退下载 / 错误态，渲染口径与 US7 一致）
 *
 * 破坏性动作只有删除：本组件负责**二次确认**，确认后才向父级上报 `remove`（不自行发请求）。
 *
 * **放大 / 缩小**（2026-10-16，`specs/011-preview-maximize`）：头部「收起」左侧的一枚可逆入口，
 * 让预览内容铺满整个视口。本组件只做三件事——渲染入口、打放大态标记类、把 Esc 转成一次请求；
 * "什么内容可放大"由 `maximizeVisible` 决定，"铺满"的定位由 `AppShell` 的预览列负责（栅格归它管）。
 */
import { computed, ref } from 'vue'

import type { ErrorInfo, FileReference, WorkspaceSpace } from '../../api/types'
import { bindFrameEscape, useMaximizeEscape } from '../../composables/useMaximizeEscape'
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
    /**
     * 头部是否显示「放大 / 缩小」入口（011）。
     *
     * 由 `usePreview.maximizeToggleVisible` 下发——**面板不自行推导**"什么内容可以放大"，
     * 判据只有会话态那一处（FR-010）；面板只负责"给了就渲染"。
     */
    maximizeVisible?: boolean
    /** 是否处于放大态（决定图标、可访问名称与根节点标记类） */
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
  /** 头部入口：放大 ↔ 缩小（011） */
  'toggle-maximize': []
  /** 放大态下按 Esc 请求退出（011） */
  'restore-maximize': []
}>()

const isContent = computed(() => props.view === 'content')

/** 内容态对应的文件引用；列表态为 `null`。 */
const reference = computed<FileReference | null>(() => {
  const current = props.target
  return current.kind === 'file' ? { dir: current.dir, filename: current.filename } : null
})

/**
 * 内容态对应的**跳转地址**目标（同源 `viewUrl` / 本地文件路径归一化后）；其余为 `null`。
 *
 * 它与 `content` 是两回事：`content` 承载"拉取到的正文"（文本 / PDF / 图片），
 * 地址目标没有正文，只有地址本身与预检结论（`renderMode`），故直接从 `target` 分派渲染。
 */
const urlTarget = computed(() => (props.target.kind === 'url' ? props.target : null))

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

/** 头部主标题：内容态显示文件/入口名，列表态显示面板名。 */
const headerTitle = computed(() => reference.value?.filename ?? urlTarget.value?.name ?? '文件空间')

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

/**
 * 内联 `iframe` 的滚动兜底（自已删除的 `PreviewPanel` 迁移）。
 *
 * 嵌入页由外部服务生成、样式不可控：若其 `html`/`body` 自带 `overflow: hidden` 或
 * 100% 高度链，内容超出 iframe 视口后**在面板里滚不动**。同源才拿得到
 * `contentDocument`，故只对同源地址生效（跨域本就直跳，不进这里）。
 */
function ensureInnerScroll(doc: Document): void {
  const style = doc.createElement('style')
  style.textContent = 'html,body{overflow:auto !important;}'
  doc.head.appendChild(style)
}

/**
 * 内联 `iframe` 的 `load`：滚动兜底 + Esc 转发（011）。
 *
 * 为什么要转发：iframe 是**独立文档**，其中按下的 Esc **不会**冒泡到本页 `window`，
 * 而"点进页面里翻"正是放大的主场景——不转发的话 `FR-021`（放大态按 Esc 退出）在
 * 最常用的路径上根本不成立。同源才拿得到 `contentDocument`（跨域直跳新窗口、PDF 由
 * 插件文档承载时该值为 `null`），两种情况都由 `bindFrameEscape` 安全跳过。
 */
function onFrameLoad(event: Event): void {
  const doc = (event.target as HTMLIFrameElement).contentDocument
  if (doc === null) {
    return
  }
  ensureInnerScroll(doc)
  bindFrameEscape(doc, () => emit('restore-maximize'))
}

/**
 * 放大态下的 Esc（011）：只在放大态挂全局监听，命中即请求退出。
 *
 * 中栏"Esc 中断本轮回答"在冒泡阶段，这里用捕获阶段先一步拦下并 `stopPropagation`，
 * 于是"按 Esc 退出放大"不会顺手掐掉正在输出的回答（FR-021）。
 */
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

        <!-- 放大 / 缩小（011）：位置固定在「收起」左侧，两态复用**同一个**按钮节点。
             图标之外必须有随状态变化的可访问名称——只换图标等于对读屏用户没有变化（FR-022） -->
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

      <!-- 同源地址目标（`viewUrl` / 本地文件路径归一化后）：按预检结论分派。
           与文件预览互斥——`openView` 只写 `target`，不写 `content` -->
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
        <!-- 文本类：原样展示（CSV / JSON 不做表格化，避免引入解析库）
             插值必须与标签同行：<pre> 保留空白，换行写法会给内容注入缩进 -->
        <pre v-if="content.renderMode === 'text'" class="workspace-panel__text">{{
          content.text
        }}</pre>

        <!-- PDF -->
        <iframe
          v-else-if="content.renderMode === 'pdf'"
          class="workspace-panel__frame"
          :src="content.url ?? ''"
          title="PDF 预览"
        />

        <!-- HTML（用户上传的静态页面，2026-10-20）：与 PDF 同形态内联，
             但 MUST 加 `sandbox=""`——脚本不执行、不共享本站源，否则等于把文件空间
             变成存储型 XSS 的入口（后端另有 `CSP: sandbox` 兜底）。 -->
        <iframe
          v-else-if="content.renderMode === 'html'"
          class="workspace-panel__frame"
          :src="content.url ?? ''"
          title="HTML 预览"
          sandbox=""
          referrerpolicy="no-referrer"
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
