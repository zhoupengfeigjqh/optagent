<script setup lang="ts">
/**
 * 工具范围弹窗（2026-10-15）。
 *
 * 由来：原先"工具范围创建后不可改"（`PUT` 携带 `allowed_tools` 即 409
 * `ADM_MCP_TOOL_SCOPE_LOCKED`），实际后果是**工具改版/下架后无从收拾**——
 * 只能删除服务重建，而重建会打断所有引用它的数字人。改为：点「重新探测」
 * 且**探测成功后立即弹本窗**，以本次探测结果（`available_tools`）为勾选基准、
 * 按当前白名单预勾选，管理员在这里增删，保存走 `PUT`（全量替换）。
 *
 * 三条纪律：
 * 1. **至少勾一个**：空数组在服务端语义是"不限制"（数字人反而看到该服务**全部**工具），
 *    与"一个都不给"正好相反，故本地先拦（服务端也会 400，这里只为少一次往返）；
 * 2. **失效项如实说明**：白名单里、本次探测已不存在的工具（下架/改名）无法勾选，
 *    保存后会被移出范围——MUST 提前告知，不能让它静默消失（`FR-009`：不静默省略）；
 * 3. **失败不关窗、勾选不丢**：保存失败（含 `ADM_CONFIG_REVISION_CONFLICT`）保留选择，
 *    管理员重试即可（原则五：等待与失败都可感知、都不丢工作）。
 *
 * 载荷由 `buildToolScopePayload` 重放（`PUT` 是全量替换语义），**刻意不带 `headers`**
 * ——详情回的是掩码，带回去等于把真令牌换成掩码。
 *
 * 可访问性基线同 `McpCreateDialog`：原生 `<dialog>` + `showModal()`
 * （焦点陷阱、Esc、焦点归还由浏览器提供；原则六"能用原生就不引库"）；
 * 勾选交互复用 `McpToolPicker`（全选/清空/截断提示只实现一份）。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useMcpServices } from '../../composables/useMcpServices'
import type { McpServiceDetail } from '../../api/types'
import { buildToolScopePayload } from '../../utils/mcp-config'
import ErrorNotice from '../common/ErrorNotice.vue'
import McpToolPicker from './McpToolPicker.vue'

const props = defineProps<{
  open: boolean
  /** 当前服务详情（含 `available_tools` = 本次探测到的全量清单） */
  service: McpServiceDetail
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** 保存成功：父级据此**原地**更新白名单与 `revision`（不重载详情，避免再探一次、丢草稿） */
  (e: 'saved', result: { allowed_tools: string[]; revision: number; affected: string[] }): void
  (e: 'announce', text: string): void
}>()

/** 本组件自己的实例：busy/error 与详情页持有的实例互不干扰 */
const m = useMcpServices()

const dialogEl = ref<HTMLDialogElement | null>(null)
/** 勾选的工具名（打开时按当前白名单预勾选） */
const selected = ref<string[]>([])
const localError = ref<string | null>(null)
/** 关闭后焦点归还的目标（打开时记录） */
let restoreFocusTo: HTMLElement | null = null

const catalog = computed(() => props.service.available_tools)
/**
 * 当前白名单里、本次探测**已不存在**的工具（下架/改名）。
 *
 * 只在探测成功时才有值——而本弹窗**只在探测成功后**打开（父级把关），
 * 所以这里不需要再处理"核对不了"的情形。
 */
const missing = computed(() =>
  props.service.allowed_tools.filter(
    (toolName) => !catalog.value.some((tool) => tool.name === toolName),
  ),
)

/** 打开时按"当前白名单 ∩ 本次探测到的工具"预勾选：失效项勾不了，故此处的差集要如实提示 */
function preSelected(): string[] {
  const names = new Set(catalog.value.map((tool) => tool.name))
  return props.service.allowed_tools.filter((toolName) => names.has(toolName))
}

function openDialog(): void {
  const el = dialogEl.value
  if (!el) return
  restoreFocusTo = (document.activeElement as HTMLElement | null) ?? null
  // jsdom 早期版本没有 showModal：降级为设置 open 属性，保证行为可测
  if (typeof el.showModal === 'function') {
    if (!el.open) el.showModal()
  } else {
    el.setAttribute('open', '')
  }
  // 键盘用户不必再 Tab 一遍才能勾选
  void nextTick(() => el.querySelector<HTMLInputElement>('[data-test="tool"]')?.focus())
}

function closeDialog(): void {
  const el = dialogEl.value
  if (el) {
    // **顺序不能反：先 `close()`，再兜底清 `open`**（2026-10-16 修复）。
    // HTML 规范里 `close()` 的第一步就是「没有 `open` 属性 → 直接返回」，
    // 而"先摘 `open` 再 `close()`"正好踩中它：`close()` 退化成**空操作**，
    // 弹窗因失去 `open` 而不可见，却**仍留在 top layer 的模态态**——页面其余部分
    // 持续 inert，表现为"点取消/保存后整页点不动，只能刷新"（真浏览器复现，
    // jsdom 没有 `close()` 故测试看不出来）。详见 `McpToolScopeDialog.spec.ts` 的 `stubClose`。
    if (typeof el.close === 'function' && el.open) el.close()
    // 兜底：降级路径（无 `showModal()`，走的是 `setAttribute('open')`）与部分 jsdom
    // 版本里 `close()` 并不清该属性——`open` 必须清掉，否则元素会一直"开着"。
    el.removeAttribute('open')
  }
  restoreFocusTo?.focus?.()
  restoreFocusTo = null
}

/** 处理中禁止关闭（取消按钮、Esc 都走这里） */
function requestClose(): void {
  if (m.busy.value) return
  emit('update:open', false)
}

/** `cancel` 由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  requestClose()
}

async function submit(): Promise<void> {
  localError.value = null
  if (selected.value.length === 0) {
    localError.value =
      '请至少勾选一个工具：空范围在平台语义里等于「不限制」，数字人反而会看到该服务的全部工具'
    return
  }

  const result = await m.saveConfig(
    props.service.name,
    buildToolScopePayload(props.service, selected.value),
    props.service.revision,
  )
  // 失败（并发冲突 / 网络 / 校验）：错误由 ErrorNotice 呈现，**弹窗不关、勾选不丢**
  if (result === null) return

  emit(
    'announce',
    result.affected.length > 0
      ? `工具范围已保存；${result.affected.length} 个引用该服务的数字人将在下次部署时生效`
      : '工具范围已保存',
  )
  emit('saved', {
    allowed_tools: [...selected.value],
    revision: result.revision,
    affected: result.affected,
  })
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) {
      selected.value = preSelected()
      localError.value = null
      m.error.value = null
      openDialog()
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
    class="mcp-tool-scope"
    aria-labelledby="mcp-tool-scope-title"
    @cancel="onCancel"
  >
    <form method="dialog" class="mcp-tool-scope__body" @submit.prevent="() => undefined">
      <h2 id="mcp-tool-scope-title" class="mcp-tool-scope__title">
        调整「{{ props.service.name }}」的工具范围
      </h2>
      <p class="mcp-tool-scope__intro">
        下列是<strong>本次探测</strong>到的全部工具（已按当前范围预勾选）。
        <strong>取消勾选即对数字人不可见</strong>；保存后需<strong>重新部署</strong>引用该服务的
        数字人才生效，未勾选与已勾选的差别不会立刻反映到运行环境。
      </p>

      <p v-if="missing.length > 0" class="mcp-tool-scope__missing" role="alert" data-test="missing">
        ⚠ 当前范围里有 {{ missing.length }} 个工具在本次探测中已不存在（下架或改名），
        它们无法勾选，保存后将从范围中移除：<span class="mono">{{ missing.join('、') }}</span>
      </p>

      <!-- 探测到 0 个工具时不给勾选：基准为空，任何选择都是凭空造范围 -->
      <p v-if="catalog.length === 0" class="mcp-tool-scope__hint" data-test="empty-catalog">
        本次探测没有取到任何工具，无法在此调整范围——请先确认该服务确实暴露了工具。
      </p>
      <McpToolPicker
        v-else
        v-model:selected="selected"
        :tools="catalog"
        :truncated="props.service.available_tools_truncated"
      />

      <p v-if="props.service.tools_error" class="mcp-tool-scope__hint" role="status">
        上一次读取工具清单失败：{{ props.service.tools_error }}
      </p>

      <p v-if="localError" class="mcp-tool-scope__error" role="alert" data-test="local-error">
        {{ localError }}
      </p>
      <ErrorNotice :error="m.error.value" title="保存未完成" />

      <div class="mcp-tool-scope__actions">
        <button
          type="button"
          class="btn"
          data-test="cancel"
          :disabled="m.busy.value"
          @click="requestClose"
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn--primary"
          data-test="save"
          :disabled="m.busy.value || catalog.length === 0"
          @click="submit"
        >
          {{ m.busy.value ? '保存中…' : '保存工具范围' }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.mcp-tool-scope {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  max-width: 640px;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.mcp-tool-scope::backdrop {
  background: var(--color-overlay);
}

.mcp-tool-scope__body {
  padding: var(--space-5);
}

.mcp-tool-scope__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.mcp-tool-scope__intro {
  margin: var(--space-2) 0 var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  line-height: var(--line-height-base);
}

/* 失效项汇总：警告色（服务本身没问题，是范围漂移了） */
.mcp-tool-scope__missing {
  margin: 0 0 var(--space-3);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-status-warning);
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);
}

.mcp-tool-scope__hint {
  margin: var(--space-2) 0;
  font-size: var(--font-size-sm);
  color: var(--color-text-muted);
}

.mcp-tool-scope__error {
  margin: var(--space-3) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}

.mcp-tool-scope__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
