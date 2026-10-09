<script setup lang="ts">
/**
 * 从本体市场导入 / 更新本体（2026-10-03，契约 §10.4~§10.6）。
 *
 * 与 `SkillMarketDialog` 同构、口径更窄：
 * - 打开即扫描市场并完成一次"文件是否变化"的检查（`ontology.yaml` 与
 *   `securities.yaml` 两个指纹比对，任一不同即「已变化」）；
 * - 状态语义：new=可导入；unchanged=已导入且文件无变化；changed=已变化**可直接更新**；
 *   invalid=市场侧文件缺失/超限/YAML 无效（不可操作，原因见详情）；
 * - **没有"人工修改确认"分支**：本体在平台侧只读、没有编辑通道，
 *   整包替换不存在"丢本地修改"的风险（那是 SKILL 独有的 `ADM_SKILL_MODIFIED`）；
 * - 失败**不关窗**：错误留在窗内，管理员可改选或刷新后重试。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  fetchOntoMarketOntologies,
  importOntoMarketOntology,
  updateOntoMarketOntology,
  type OntologyMarketItem,
  type OntologyMarketListing,
  type OntologyWriteResult,
} from '../../api/ontologies'
import type { ErrorInfo } from '../../api/types'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'imported', result: OntologyWriteResult): void
  (e: 'updated', result: OntologyWriteResult): void
  (e: 'error', message: string): void
}>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const listing = ref<OntologyMarketListing | null>(null)
const loading = ref(false)
const busy = ref(false)
const selected = ref<OntologyMarketItem | null>(null)
const error = ref<ErrorInfo | null>(null)
let restoreFocusTo: HTMLElement | null = null

const STATUS_TEXT: Record<OntologyMarketItem['status'], string> = {
  new: '可导入',
  unchanged: '已导入 · 市场无变化',
  changed: '市场文件已变化 · 可更新',
  invalid: '不可导入',
}

/** 可操作：new 走导入；changed 走更新。unchanged / invalid 一律不可选 */
function canSelect(item: OntologyMarketItem): boolean {
  if (item.invalid_reason !== null) return false
  return item.status === 'new' || item.status === 'changed'
}

function statusText(item: OntologyMarketItem): string {
  return item.invalid_reason ?? STATUS_TEXT[item.status]
}

function select(item: OntologyMarketItem): void {
  if (!canSelect(item)) return
  selected.value = item
  error.value = null
}

function requestClose(): void {
  emit('update:open', false)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    listing.value = await fetchOntoMarketOntologies()
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 主操作：按所选状态分派导入 / 更新 */
async function proceed(): Promise<void> {
  const item = selected.value
  if (!item || busy.value || !canSelect(item)) return
  busy.value = true
  error.value = null
  const isUpdate = item.status === 'changed'
  try {
    const result = isUpdate
      ? await updateOntoMarketOntology(item.scenario, item.ontology_dir)
      : await importOntoMarketOntology(item.scenario, item.ontology_dir)
    emit(isUpdate ? 'updated' : 'imported', result)
    requestClose()
  } catch (err) {
    // 失败不关窗：错误留在窗内，管理员可刷新后重试
    error.value = err as ErrorInfo
    emit('error', isUpdate ? '更新未完成，请查看错误原因' : '导入未完成，请查看错误原因')
  } finally {
    busy.value = false
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
  <dialog
    ref="dialogEl"
    class="ontology-market"
    aria-labelledby="ontology-market-title"
    @cancel="onCancel"
  >
    <div class="ontology-market__body">
      <h2 id="ontology-market-title" class="ontology-market__title">从本体市场导入本体</h2>
      <p class="ontology-market__hint">
        本体来自 optonto 本体市场（平台只读），同步
        <strong>ontology.yaml 与 securities.yaml</strong>（行为安全管控，市场侧没有则不同步）。
        打开本窗口即检查一次这两个文件是否变化；检测到「已变化」的本体可在本窗口直接更新。
      </p>

      <ErrorNotice v-if="error" :error="error" title="操作未完成" />

      <p v-if="loading" role="status">正在扫描本体市场…</p>
      <p v-else-if="listing && !listing.configured" class="ontology-market__empty" role="alert">
        {{ listing.reason }}
      </p>
      <p v-else-if="listing && listing.items.length === 0" class="ontology-market__empty">
        {{ listing.reason ?? '本体市场里还没有可导入的本体。' }}
      </p>

      <ul v-else-if="listing" class="ontology-market__items">
        <li v-for="item in listing.items" :key="`${item.scenario}/${item.ontology_dir}`">
          <button
            type="button"
            class="ontology-market__item"
            :class="{ 'ontology-market__item--selected': selected === item }"
            :disabled="!canSelect(item) || busy"
            :aria-pressed="selected === item"
            @click="select(item)"
          >
            <span class="ontology-market__main">
              <span class="mono">{{ item.name ?? item.ontology_dir }}</span>
              <span class="ontology-market__desc">
                {{ item.metadata?.deployed_version ? `版本 ${item.metadata.deployed_version} · ` : ''
                }}{{ item.metadata?.created_at ?? '' }}
                <template v-if="item.has_securities"> · 含安全管控</template>
              </span>
              <span class="ontology-market__path">{{ item.scenario }} / {{ item.ontology_dir }}</span>
            </span>
            <span class="ontology-market__status" :data-status="item.status">{{
              statusText(item)
            }}</span>
          </button>
        </li>
      </ul>

      <p v-if="selected" class="ontology-market__selected" role="status">
        已选择：{{ selected.name }}（{{ selected.scenario }} / {{ selected.ontology_dir }}）——
        {{ selected.status === 'changed' ? '将以市场现版本更新库内本体' : '将导入本体库' }}
      </p>

      <div class="ontology-market__actions">
        <button type="button" class="btn" :disabled="loading || busy" @click="void load()">
          刷新
        </button>
        <button
          type="button"
          class="btn"
          data-test="close"
          :disabled="busy"
          @click="requestClose"
        >
          关闭
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="import"
          :disabled="selected === null || busy"
          @click="proceed"
        >
          {{
            busy
              ? '处理中…'
              : selected?.status === 'changed'
                ? '更新选中本体'
                : '导入选中本体'
          }}
        </button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.ontology-market {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.ontology-market::backdrop {
  background: var(--color-overlay);
}

.ontology-market__body {
  padding: var(--space-5);
}

.ontology-market__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.ontology-market__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
  line-height: var(--line-height-base);
}

.ontology-market__empty {
  margin: var(--space-4) 0 0;
  color: var(--color-text-secondary);
}

.ontology-market__items {
  list-style: none;
  margin: var(--space-4) 0 0;
  padding: 0;
  max-height: 46vh;
  overflow-y: auto;
}

.ontology-market__item {
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

.ontology-market__item + .ontology-market__item,
li + li .ontology-market__item {
  margin-top: var(--space-2);
}

.ontology-market__item--selected {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
}

.ontology-market__item:disabled {
  cursor: not-allowed;
  opacity: 0.72;
}

.ontology-market__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ontology-market__desc {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ontology-market__path {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.ontology-market__status {
  flex-shrink: 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.ontology-market__status[data-status='new'] {
  color: var(--color-status-success);
}

.ontology-market__status[data-status='changed'] {
  color: var(--color-status-warning);
}

.ontology-market__status[data-status='invalid'] {
  color: var(--color-status-error);
}

.ontology-market__selected {
  margin: var(--space-3) 0 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.ontology-market__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
