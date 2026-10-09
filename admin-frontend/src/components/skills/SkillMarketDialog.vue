<script setup lang="ts">
/**
 * 从本体市场导入 / 更新 SKILL（2026-10-02；更新流 2026-10-02 §4.8）。
 *
 * - 市场目录（optonto `.data/onto_market`）由平台**只读**扫描；打开对话框即完成
 *   一次"市场文件是否变化"的检查（整包内容指纹比对）；
 * - 状态语义：new=可导入；unchanged=已导入且市场无变化；changed=市场已变化，
 *   **可直接更新**（整包原子替换）；conflict=库内同名但非市场来源（不可操作）；
 * - 更新护栏：库内版本被人工修改过时服务端返回 `ADM_SKILL_MODIFIED`，
 *   窗内展示确认提示，管理员点击"仍要更新"才携带 confirm 重试；
 * - 导入/更新失败**不关窗**，错误留在窗内（与"校验失败不关窗"同一口径）；
 * - 原生 `<dialog>` + `showModal()`：焦点陷阱与 Esc 关闭由浏览器提供（D5）。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { fetchOntoMarket, installOntoMarketSkill, updateOntoMarketSkill } from '../../api/skills'
import type { OntoMarketItem, OntoMarketListing, OntoMarketUpdateResult } from '../../api/onto-market'
import type { ErrorInfo, SkillInstallResult } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'installed', result: SkillInstallResult): void
  (e: 'updated', result: OntoMarketUpdateResult): void
  (e: 'error', message: string): void
}>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const listing = ref<OntoMarketListing | null>(null)
const loading = ref(false)
const importing = ref(false)
const selected = ref<OntoMarketItem | null>(null)
const error = ref<ErrorInfo | null>(null)
/** 服务端提示"库内版本被人工修改过"（ADM_SKILL_MODIFIED）：展示确认入口 */
const modifiedWarning = ref<ErrorInfo | null>(null)
let restoreFocusTo: HTMLElement | null = null

const STATUS_TEXT: Record<OntoMarketItem['status'], string> = {
  new: '可导入',
  unchanged: '已导入 · 市场无变化',
  changed: '市场文件已变化 · 可更新',
  conflict: '库内已有同名技能',
  invalid: '格式无效',
}

/** 可操作：new 走导入；changed 走更新。conflict / invalid 一律不可选 */
function canSelect(item: OntoMarketItem): boolean {
  if (item.invalid_reason !== null || item.name === null) return false
  return item.status === 'new' || item.status === 'changed'
}

function statusText(item: OntoMarketItem): string {
  return item.invalid_reason ?? STATUS_TEXT[item.status]
}

function select(item: OntoMarketItem): void {
  if (!canSelect(item)) return
  selected.value = item
  modifiedWarning.value = null
  error.value = null
}

function requestClose(): void {
  emit('update:open', false)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  modifiedWarning.value = null
  try {
    listing.value = await fetchOntoMarket()
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 主操作：按所选状态分派导入 / 更新 */
async function proceed(): Promise<void> {
  const item = selected.value
  if (!item || importing.value || !canSelect(item)) return
  importing.value = true
  error.value = null
  modifiedWarning.value = null
  try {
    if (item.status === 'changed') {
      const result = await updateOntoMarketSkill(item.scenario, item.ontology, item.skill_dir, false)
      emit('updated', result)
    } else {
      const result = await installOntoMarketSkill(item.scenario, item.ontology, item.skill_dir)
      emit('installed', result)
    }
    requestClose()
  } catch (err) {
    const info = err as ErrorInfo
    if (info.code === 'ADM_SKILL_MODIFIED') {
      // 人工修改确认：留在窗内展示提示，由管理员显式确认（不静默覆盖）
      modifiedWarning.value = info
    } else {
      // 失败不关窗：错误留在窗内，管理员可改选或刷新后重试
      error.value = info
      emit('error', item.status === 'changed' ? '更新未完成，请查看错误原因' : '导入未完成，请查看错误原因')
    }
  } finally {
    importing.value = false
  }
}

/** 人工修改确认后的重试（confirm: true） */
async function confirmUpdate(): Promise<void> {
  const item = selected.value
  if (!item || importing.value) return
  importing.value = true
  modifiedWarning.value = null
  try {
    const result = await updateOntoMarketSkill(item.scenario, item.ontology, item.skill_dir, true)
    emit('updated', result)
    requestClose()
  } catch (err) {
    error.value = err as ErrorInfo
    emit('error', '更新未完成，请查看错误原因')
  } finally {
    importing.value = false
  }
}

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    if (typeof el.close === 'function' && el.open) el.close()
    else el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) {
      openDialog()
      selected.value = null
      error.value = null
      void load()
    } else {
      closeDialog()
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  const el = dialogEl.value
  if (el && typeof el.close === 'function' && el.open) el.close()
})
</script>

<template>
  <dialog ref="dialogEl" class="skill-market" aria-labelledby="skill-market-title" @cancel="onCancel">
    <div class="skill-market__body">
      <h2 id="skill-market-title" class="skill-market__title">从本体市场导入 SKILL</h2>
      <p class="skill-market__hint">
        技能来自 optonto 本体市场（平台只读）。打开本窗口即检查一次市场文件是否变化；
        导入的是整包快照，市场后续更新不会自动同步——检测到"已变化"的技能可在本窗口直接更新。
      </p>

      <ErrorNotice v-if="error" :error="error" title="导入未完成" />

      <div v-if="modifiedWarning" class="skill-market__confirm" role="alert">
        <p class="skill-market__confirm-text">{{ modifiedWarning.message }}</p>
        <div class="skill-market__confirm-actions">
          <button type="button" class="btn" :disabled="importing" @click="modifiedWarning = null">
            取消
          </button>
          <button
            type="button"
            class="btn btn--danger"
            data-test="confirm-update"
            :disabled="importing"
            @click="confirmUpdate"
          >
            仍要更新（丢弃人工修改）
          </button>
        </div>
      </div>

      <p v-if="loading" role="status">正在扫描本体市场…</p>
      <p v-else-if="listing && !listing.configured" class="skill-market__empty" role="alert">
        {{ listing.reason }}
      </p>
      <p v-else-if="listing && listing.items.length === 0" class="skill-market__empty">
        {{ listing.reason ?? '本体市场里还没有可导入的技能。' }}
      </p>

      <ul v-else-if="listing" class="skill-market__items">
        <li
          v-for="item in listing.items"
          :key="`${item.scenario}/${item.ontology}/${item.skill_dir}`"
        >
          <button
            type="button"
            class="skill-market__item"
            :class="{ 'skill-market__item--selected': selected === item }"
            :disabled="!canSelect(item) || importing"
            :aria-pressed="selected === item"
            @click="select(item)"
          >
            <span class="skill-market__main">
              <span class="mono">{{ item.name ?? item.skill_dir }}</span>
              <span class="skill-market__desc">{{ item.description ?? item.invalid_reason }}</span>
              <span class="skill-market__path">{{ item.scenario }} / {{ item.ontology }}</span>
            </span>
            <span class="skill-market__status" :data-status="item.status">{{
              statusText(item)
            }}</span>
          </button>
        </li>
      </ul>

      <p v-if="selected" class="skill-market__selected" role="status">
        已选择：{{ selected.name }}（{{ selected.scenario }} / {{ selected.ontology }}）——
        {{ selected.status === 'changed' ? '将以市场现版本更新库内技能' : '将整包导入共享技能库' }}
      </p>

      <div class="skill-market__actions">
        <button type="button" class="btn" :disabled="loading || importing" @click="void load()">
          刷新
        </button>
        <button type="button" class="btn" data-test="close" :disabled="importing" @click="requestClose">
          关闭
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="import"
          :disabled="selected === null || importing || modifiedWarning !== null"
          @click="proceed"
        >
          {{
            importing
              ? '处理中…'
              : selected?.status === 'changed'
                ? '更新选中技能'
                : '导入选中技能'
          }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.skill-market {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.skill-market::backdrop {
  background: var(--color-overlay);
}

.skill-market__body {
  padding: var(--space-5);
}

.skill-market__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.skill-market__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-base);
}

.skill-market__empty {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}

.skill-market__items {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
}

.skill-market__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.skill-market__item + .skill-market__item,
li + li .skill-market__item {
  margin-top: var(--space-2);
}

.skill-market__item--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
}

.skill-market__item:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.skill-market__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.skill-market__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.skill-market__path {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.skill-market__status {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.skill-market__status[data-status='new'] {
  color: var(--color-status-success);
}

.skill-market__status[data-status='changed'],
.skill-market__status[data-status='conflict'] {
  color: var(--color-status-warning);
}

.skill-market__status[data-status='invalid'] {
  color: var(--color-status-error);
}

.skill-market__selected {
  margin: var(--space-3) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.skill-market__confirm {
  margin: var(--space-4) 0 0;
  padding: var(--space-3);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-md);
  background: var(--color-status-warning-bg, rgb(255 191 0 / 8%));
}

.skill-market__confirm-text {
  margin: 0;
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.skill-market__confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.skill-market__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
