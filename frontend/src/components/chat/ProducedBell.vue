<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { ProducedItem } from '../../api/produced'
import { useProduced } from '../../composables/useProduced'
import { useToast } from '../../composables/useToast'
import { resolvePreviewKind } from '../../utils/file-kind'
import { formatBytes, formatTimestamp } from '../../utils/format'
import { fallbackHint, parseProducedContent } from '../../utils/produced-content'
import {
  badgeText,
  producedSummary,
  producedTag,
  producedTagFull,
  splitProducedPath,
} from '../../utils/produced-display'
import { filePathToPreviewPath, type ViewLinkTarget } from '../../utils/view-link'
import BaseDialog from '../common/BaseDialog.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import ProducedJsonView from './ProducedJsonView.vue'

const produced = useProduced()

const emit = defineEmits<{
  'open-view': [item: ViewLinkTarget]
}>()

const open = ref(false)
const view = ref<'list' | 'content'>('list')
const active = ref<ProducedItem | null>(null)
const content = ref<string | null>(null)
const contentLoading = ref(false)
const structuredView = ref(true)

const unread = computed(() => produced.unreadCount.value)
/** 正文解析结果（可结构化 / 原样 + 降级原因） */
const parsed = computed(() => parseProducedContent(content.value))
const isFileActive = computed(
  () => active.value !== null && resolvePreviewKind(active.value.filename) !== 'text',
)
/** 不可结构化的可读提示（目前只有"太大"需要解释，其余原样展示是预期行为） */
const contentHint = computed(() => fallbackHint(parsed.value.reason))

/**
 * 弹窗宽度：**结构化正文**（表格/嵌套对象）横向内容多，用宽版——否则表格几十列
 * 在 560px 里只能看见五六列，其余全靠横向滚动。
 * 列表视图与"原始 JSON"文本视图维持默认宽度：那两种形态窄一点反而更好读。
 */
const wideDialog = computed(
  () => view.value === 'content' && parsed.value.structured && structuredView.value,
)

const toast = useToast()
let offNewItems: (() => void) | null = null

function announceNewItems(added: readonly ProducedItem[]): void {
  if (added.length === 0) return
  const text =
    added.length === 1
      ? `后台任务完成：${producedSummary(added[0]!.summary)}`
      : `后台任务完成：${added.length} 个新结果`
  toast.push('success', text, {
    label: '查看',
    run: () => {
      open.value = true
    },
  })
}

onMounted(() => {
  void produced.refresh()
  produced.start()
  offNewItems = produced.onNewItems(announceNewItems)
})
onBeforeUnmount(() => {
  offNewItems?.()
  offNewItems = null
  produced.stop()
})

const buttonLabel = computed(() =>
  unread.value > 0 ? `后台记录，${unread.value} 条未读` : '后台记录',
)
/**
 * 悬停说明（2026-10-30）：与左侧定时任务入口（闪电）同一手法——原生 `title`。
 *
 * 同一排的两个图标按钮，悬停反馈必须一致：闪电有说明而铃铛没有，用户只能靠猜。
 * 文案与读屏名称同源（`buttonLabel` 的信息 + "点击查看"这个动作），
 * 有未读时把条数带上，避免为了看条数还得点开。
 */
const buttonTitle = computed(() =>
  unread.value > 0 ? `后台记录：${unread.value} 条未读，点击查看` : '后台记录，点击查看',
)
const dialogTitle = computed(() => (view.value === 'list' ? '后台记录' : '后台结果'))

function titleOf(item: ProducedItem): { summary: string; tag: string; tagFull: string } {
  return {
    summary: producedSummary(item.summary),
    tag: producedTag(item.tool, item.job_id),
    tagFull: producedTagFull(item.tool, item.job_id),
  }
}

/** 数字人名称：`agent_name` 缺省（`sid` 缺失 / 会话已删除）时给可读兜底，不留白 */
function agentNameOf(item: ProducedItem): string {
  const name = item.agent_name?.trim() ?? ''
  return name === '' ? '未知数字人' : name
}

const TIME_OPTS = { withSeconds: true, fallback: '时间未知' } as const

function fieldsOf(item: ProducedItem): Array<{ label: string; value: string }> {
  return [
    { label: '数字人', value: agentNameOf(item) },
    // （工具全名等）风格不一。注意它描述的是平台侧"回写完成"，当前恒为 `done`；业务状态
    { label: '状态', value: item.status },
    { label: '创建', value: formatTimestamp(item.created_at, TIME_OPTS) },
    { label: '完成', value: formatTimestamp(item.finished_at, TIME_OPTS) },
    { label: '大小', value: formatBytes(item.size, '—') },
  ]
}

const rows = computed(() => produced.items.value.map((item) => ({ item, title: titleOf(item) })))

const activeTitle = computed(() => (active.value ? titleOf(active.value) : null))

async function openItem(item: ProducedItem): Promise<void> {
  active.value = item
  view.value = 'content'
  content.value = null
  structuredView.value = true
  void produced.markRead([item.job_id])
  if (resolvePreviewKind(item.filename) !== 'text') {
    contentLoading.value = false
    return
  }
  contentLoading.value = true
  content.value = await produced.text(item.job_id)
  contentLoading.value = false
}

/**
 * 打开文件产出：与聊天区的 `filePath` 入口走**同一条路**（交给装配层的工作空间面板，
 * 按扩展名分派——`.xlsx` 给下载引导）。`line` 面板是模态框，必须先关（见 `onOpenView`）。
 */
function openFileItem(item: ProducedItem): void {
  const { filename } = splitProducedPath(item.relPath)
  onOpenView({
    url: filePathToPreviewPath(item.relPath),
    name: filename,
    kind: 'file',
    filePath: item.relPath,
  })
}

function backToList(): void {
  view.value = 'list'
  active.value = null
  content.value = null
  structuredView.value = true
}

function closePanel(): void {
  open.value = false
  backToList()
}

/**
 * 正文里的视图链接点击（2026-10-20）。
 *
 * **必须先关模态框再上报**：`<dialog>.showModal()` 处于浏览器 top layer，右侧工作空间面板
 * 在文档层里，不关就会被整块盖住——用户看到的是"点了没反应"。
 */
function onOpenView(item: ViewLinkTarget): void {
  closePanel()
  emit('open-view', item)
}
</script>

<template>
  <button
    type="button"
    class="produced-bell"
    :aria-label="buttonLabel"
    :title="buttonTitle"
    :aria-pressed="open ? 'true' : 'false'"
    @click="open = true"
  >
    <BaseIcon name="bell" :size="16" />
    <span v-if="unread > 0" class="produced-bell__badge" aria-hidden="true">
      {{ badgeText(unread) }}
    </span>
  </button>

  <BaseDialog :open="open" :title="dialogTitle" :wide="wideDialog" @close="closePanel">
    <template v-if="view === 'content' && active">
      <div class="produced-content__head">
        <button type="button" class="produced-content__back" @click="backToList">
          <BaseIcon name="chevron-left" :size="14" />
          返回列表
        </button>
        <span v-if="activeTitle" class="produced-title">
          <span class="produced-title__summary" :title="activeTitle.summary">
            {{ activeTitle.summary }}
          </span>
          <span class="produced-title__tag" :title="activeTitle.tagFull">{{
            activeTitle.tag
          }}</span>
        </span>
        <span class="produced-content__meta">
          <span
            v-for="field in fieldsOf(active)"
            :key="field.label"
            class="produced-content__field"
          >
            {{ field.label }}：{{ field.value }}
          </span>
        </span>
      </div>

      <div v-if="isFileActive" class="produced-content__file">
        <p class="produced-panel__hint">
          该产出是文件（{{ active.filename }}），不在面板里按文本展示。
        </p>
        <button type="button" class="produced-content__view-toggle" @click="openFileItem(active)">
          打开 / 下载文件
        </button>
      </div>
      <p v-else-if="contentLoading" class="produced-panel__hint">正在读取…</p>
      <p v-else-if="content === null" class="produced-panel__hint">
        内容不可读——该产出可能已被清理（临时空间 30 天未访问即清理）。
      </p>
      <template v-else>
        <div v-if="parsed.structured" class="produced-content__toolbar">
          <button
            type="button"
            class="produced-content__view-toggle"
            @click="structuredView = !structuredView"
          >
            {{ structuredView ? '按原始 JSON 查看' : '按结构化查看' }}
          </button>
        </div>
        <ProducedJsonView
          v-if="parsed.structured && structuredView"
          :value="parsed.value"
          @open-view="onOpenView"
        />
        <pre v-else class="produced-content__body">{{ content }}</pre>
        <p v-if="contentHint" class="produced-panel__hint">{{ contentHint }}</p>
      </template>
    </template>

    <template v-else>
      <ErrorNotice v-if="produced.error.value" :error="produced.error.value" />

      <p v-else-if="produced.items.value.length === 0" class="produced-panel__hint">
        {{
          produced.loading.value
            ? '正在加载…'
            : '还没有后台任务结果。异步工具（如 OCR）算完后，结果会出现在这里。'
        }}
      </p>

      <ul v-else class="produced-panel__list">
        <li
          v-for="row in rows"
          :key="row.item.job_id"
          class="produced-item"
          :class="{ 'produced-item--unread': row.item.read_at === undefined }"
        >
          <button type="button" class="produced-item__button" @click="openItem(row.item)">
            <BaseIcon
              v-if="row.item.read_at === undefined"
              name="alert"
              :size="14"
              label="未读"
              class="produced-item__flag"
            />
            <span class="produced-item__body">
              <span class="produced-title">
                <span class="produced-title__summary" :title="row.title.summary">
                  {{ row.title.summary }}
                </span>
                <span class="produced-title__tag" :title="row.title.tagFull">
                  {{ row.title.tag }}
                </span>
              </span>
              <span class="produced-item__meta">
                <span
                  v-for="field in fieldsOf(row.item)"
                  :key="field.label"
                  class="produced-item__field"
                >
                  {{ field.label }}：{{ field.value }}
                </span>
              </span>
            </span>
          </button>
        </li>
      </ul>
    </template>
  </BaseDialog>
</template>

<style scoped>
.produced-bell {
  position: relative;
  display: inline-flex;
  padding: var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
}

.produced-bell:hover {
  background: var(--color-bg-subtle);
  color: var(--color-text);
}

.produced-bell[aria-pressed='true'] {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.produced-bell__badge {
  position: absolute;
  top: 0;
  right: 0;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--color-danger, #d92d20);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
  transform: translate(35%, -35%);
}

.produced-panel__hint {
  margin: 0;
  color: var(--color-text-muted);
}

.produced-panel__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  max-height: 60vh;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.produced-item__button {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.produced-item__button:hover {
  background: var(--color-bg-subtle);
}

.produced-item--unread .produced-item__button {
  box-shadow: inset 3px 0 0 var(--color-primary);
}

.produced-item__flag {
  flex: none;
  margin-top: 2px;
  color: var(--color-primary);
}

.produced-item__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* 标题行（列表与内容视图共用）：摘要**弹性收缩**、标识**固定不缩**。
   标识已由 `producedTag` 中间省略到有界宽度，故这里不必再让它参与收缩——
   否则被省略号吃掉的又是它的尾巴（`job_id` 正好在最末）。 */
.produced-title {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.produced-title__summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.produced-title__tag {
  flex: none;
  font-family: var(--font-family-mono, monospace);
  font-size: 0.85em;
  color: var(--color-text-muted);
  white-space: nowrap;
  user-select: all;
}

.produced-item__meta,
.produced-content__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-2);
  font-size: 0.85em;
  color: var(--color-text-muted);
}

.produced-content__head {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-2);
}

.produced-content__back {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  align-self: flex-start;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--color-primary);
  cursor: pointer;
}

.produced-content__head .produced-title {
  align-items: flex-start;
  flex-wrap: wrap;
}

.produced-content__head .produced-title__summary {
  font-weight: 600;
  white-space: normal;
  word-break: break-word;
}

.produced-content__toolbar {
  display: flex;
  justify-content: flex-end;
}

.produced-content__view-toggle {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.produced-content__view-toggle:hover {
  color: var(--color-text);
  border-color: var(--color-text-muted);
}

.produced-content__body {
  max-height: 55vh;
  margin: 0;
  padding: var(--space-2);
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-family: inherit;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
