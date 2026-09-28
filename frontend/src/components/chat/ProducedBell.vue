<script setup lang="ts">
/**
 * 后台产出铃铛（R11，契约 §10.5 ⑥⑦）
 *
 * - 右上角入口 + **未读角标**（0 时**不显示**）；
 * - 挂载即**拉一次列表**并**订阅信号**（收到即重拉）——离线期间到达的产出因此
 *   在下次打开页面时自然补齐（信号丢失无后果，§10.5 ①）；
 * - 面板**双视图**（列表 ⇄ 单条正文，与 `WorkspacePanel` 的"列表/内容"同构）。
 *   正文走 `GET /api/produced/raw`——**不能用 `files` 的预览接口**：那个接口的 `dir`
 *   是空间顶层目录，而产出在二级目录 `临时空间/后台产出/`（⑦ 的记录就是这么踩出来的）；
 * - 未读条带叹号（图标 + 无障碍名称双通道，原则四）；**点开某条才标记已读**（⑤）；
 * - `summary` 缺省时给**可读兜底**，MUST NOT 把机读文件名顶上来当标题；
 * - 正文**默认结构化展示**（`ProducedJsonView`）：能解析成对象/数组就按与 HITL 同构的规则
 *   渲染，并可一键切回**原始 JSON**；解析不了（纯文本/标量/超阈值）**回落 `<pre>`**。
 *   这是**展示层**的解析，平台仍"原样存、原样读"（契约 §10.3）。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import type { ProducedItem } from '../../api/produced'
import { useProduced } from '../../composables/useProduced'
import { fallbackHint, parseProducedContent } from '../../utils/produced-content'
import { badgeText, formatBytes, formatDateTime } from '../../utils/produced-display'
import BaseDialog from '../common/BaseDialog.vue'
import BaseIcon from '../common/BaseIcon.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import ProducedJsonView from './ProducedJsonView.vue'

const produced = useProduced()

const open = ref(false)
/** 面板视图：列表 ⇄ 单条正文 */
const view = ref<'list' | 'content'>('list')
/** 内容视图当前展示的条目 */
const active = ref<ProducedItem | null>(null)
const content = ref<string | null>(null)
const contentLoading = ref(false)
/** 正文展示形态：结构化 ⇄ 原始 JSON（仅当正文可结构化时才有意义） */
const structuredView = ref(true)

const unread = computed(() => produced.unreadCount.value)
/** 正文解析结果（可结构化 / 原样 + 降级原因） */
const parsed = computed(() => parseProducedContent(content.value))
/** 不可结构化的可读提示（目前只有"太大"需要解释，其余原样展示是预期行为） */
const contentHint = computed(() => fallbackHint(parsed.value.reason))

onMounted(() => {
  // 「打开页面补算 + 在线订阅」两条都要：前者覆盖离线期间到达的产出，后者保证在线即时
  void produced.refresh()
  produced.start()
})
onBeforeUnmount(() => produced.stop())

const buttonLabel = computed(() =>
  unread.value > 0 ? `后台记录，${unread.value} 条未读` : '后台记录',
)
const dialogTitle = computed(() => (view.value === 'list' ? '后台记录' : '后台结果'))

/**
 * 摘要（标题的**唯一**来源）。
 *
 * `summary` 由服务提供（OCR 取识别结果的**首个非空行**）；缺省时给一句**人类可读**的
 * 兜底——**MUST NOT** 回落成落盘文件名：那是 `{会话UUID}_{job_id}`，纯机读，
 * 对人而言只是一串无意义的字符（2026-09-25 实测反馈）。
 */
function summaryOf(item: ProducedItem): string {
  const text = item.summary?.trim() ?? ''
  return text === '' ? '后台任务结果（该任务未提供摘要）' : text
}

/** 数字人名称：`agent_name` 缺省（`sid` 缺失 / 会话已删除）时给可读兜底，不留白 */
function agentNameOf(item: ProducedItem): string {
  const name = item.agent_name?.trim() ?? ''
  return name === '' ? '未知数字人' : name
}

/** 工具名：空串时给可读兜底（服务未回传 `tool` 的情形） */
function toolNameOf(item: ProducedItem): string {
  const tool = item.tool.trim()
  return tool === '' ? '未知工具' : tool
}

/** 元信息行（列表与内容视图共用，数组顺序即展示顺序） */
function fieldsOf(item: ProducedItem): Array<{ label: string; value: string }> {
  return [
    { label: '工具', value: toolNameOf(item) },
    { label: '数字人', value: agentNameOf(item) },
    // 状态**原样透出**（不翻译）：它是协议值，翻译层要多一处同步维护的映射，且与其它技术字段
    // （工具全名等）风格不一。注意它描述的是平台侧"回写完成"，当前恒为 `done`；业务状态
    // （如排产的 80/2/90）在正文与 `summary` 里，平台按契约不解析正文（§10.3）。
    { label: '状态', value: item.status },
    { label: '创建', value: formatDateTime(item.created_at) },
    { label: '完成', value: formatDateTime(item.finished_at) },
    { label: '大小', value: formatBytes(item.size) },
  ]
}

/**
 * 打开某条：**先标记已读**，再拉正文并切到内容视图。
 *
 * 顺序刻意如此——标记表达的是"用户确实看过了"；正文读取可能失败（多半是已被 7 天清理），
 * 那时用户也**已经知道**这条的存在与结局，未读不该继续挂着。
 */
async function openItem(item: ProducedItem): Promise<void> {
  active.value = item
  view.value = 'content'
  content.value = null
  contentLoading.value = true
  structuredView.value = true
  void produced.markRead([item.job_id])
  content.value = await produced.text(item.job_id)
  contentLoading.value = false
}

function backToList(): void {
  view.value = 'list'
  active.value = null
  content.value = null
  structuredView.value = true
}

/** 关闭面板：一并回到列表态，下次打开不残留上一条的正文 */
function closePanel(): void {
  open.value = false
  backToList()
}
</script>

<template>
  <button
    type="button"
    class="produced-bell"
    :aria-label="buttonLabel"
    :aria-pressed="open ? 'true' : 'false'"
    @click="open = true"
  >
    <BaseIcon name="bell" :size="16" />
    <!-- 角标对读屏隐藏：未读数已在按钮的 aria-label 里表达，重复播报是噪声（原则四） -->
    <span v-if="unread > 0" class="produced-bell__badge" aria-hidden="true">
      {{ badgeText(unread) }}
    </span>
  </button>

  <BaseDialog :open="open" :title="dialogTitle" @close="closePanel">
    <!-- 内容视图：单条产出正文 -->
    <template v-if="view === 'content' && active">
      <div class="produced-content__head">
        <button type="button" class="produced-content__back" @click="backToList">
          <BaseIcon name="chevron-left" :size="14" />
          返回列表
        </button>
        <span class="produced-content__title">{{ summaryOf(active) }}</span>
        <span class="produced-content__meta">
          <span v-for="field in fieldsOf(active)" :key="field.label" class="produced-content__field">
            {{ field.label }}：{{ field.value }}
          </span>
        </span>
      </div>

      <p v-if="contentLoading" class="produced-panel__hint">正在读取…</p>
      <p v-else-if="content === null" class="produced-panel__hint">
        内容不可读——该产出可能已被清理（临时空间 7 天未访问即清理）。
      </p>
      <template v-else>
        <!-- 可结构化时才给切换：解析不了就没有"另一种形态"可切 -->
        <div v-if="parsed.structured" class="produced-content__toolbar">
          <button
            type="button"
            class="produced-content__view-toggle"
            @click="structuredView = !structuredView"
          >
            {{ structuredView ? '按原始 JSON 查看' : '按结构化查看' }}
          </button>
        </div>
        <ProducedJsonView v-if="parsed.structured && structuredView" :value="parsed.value" />
        <pre v-else class="produced-content__body">{{ content }}</pre>
        <p v-if="contentHint" class="produced-panel__hint">{{ contentHint }}</p>
      </template>
    </template>

    <!-- 列表视图 -->
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
          v-for="item in produced.items.value"
          :key="item.job_id"
          class="produced-item"
          :class="{ 'produced-item--unread': item.read_at === undefined }"
        >
          <button type="button" class="produced-item__button" @click="openItem(item)">
            <BaseIcon
              v-if="item.read_at === undefined"
              name="alert"
              :size="14"
              label="未读"
              class="produced-item__flag"
            />
            <span class="produced-item__body">
              <span class="produced-item__summary">{{ summaryOf(item) }}</span>
              <span class="produced-item__meta">
                <span v-for="field in fieldsOf(item)" :key="field.label" class="produced-item__field">
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

/* 未读：左侧色条 + 叹号图标（双通道，不单靠颜色） */
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

.produced-item__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 列表与内容视图共用同一条元信息样式：字段可换行，窄面板下不挤成一团 */
.produced-item__meta,
.produced-content__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px var(--space-2);
  font-size: 0.85em;
  color: var(--color-text-muted);
}

/* 内容视图：单条产出正文 */
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

.produced-content__title {
  font-weight: 600;
  word-break: break-word;
}

/* 结构化 ⇄ 原始 JSON 切换：靠右，不抢标题的视觉重心 */
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
