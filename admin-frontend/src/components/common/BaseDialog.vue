<script lang="ts">
/**
 * 标题 id 计数器：模块级（`<script setup>` 顶层变量是**每实例**的，放那里每次都从 0 开始）。
 *
 * 不用 `useId()`：它按 Vue app 实例计数，多个 `mount()` 出来的 app 会各自从 0 开始，反而撞号。
 */
let titleSeq = 0

/** 取下一个标题 id（同页面多实例的 `aria-labelledby` 因此互不相同） */
export function nextTitleId(): string {
  titleSeq += 1
  return `base-dialog-title-${titleSeq}`
}
</script>

<script setup lang="ts">
/**
 * 通用弹窗壳（原生 `<dialog>` + `showModal()`）。
 *
 * 为什么用原生 dialog（与 `ConfirmDialog` 同一决定，`research.md` D5）：焦点陷阱、
 * `aria-modal`、Esc 关闭由浏览器提供；自建 Modal 必然在这些点上退化（宪章原则四）。
 *
 * 本组件只承载**壳**：标题 + 内容 + 底部动作。打开 / 关闭 / 焦点归还集中在这里，
 * 调用方不再各写一份（原则二：同一职责唯一来源）。存量 `ConfirmDialog` 与
 * `McpCreateDialog` 自带同一份逻辑，属未迁移的存量，新增弹窗 MUST 用本组件。
 *
 * 焦点：打开后聚焦内容里的 `[data-autofocus]` 元素；没标记则不干预
 * （浏览器会聚焦首个可聚焦子元素）。关闭后焦点归还打开前的元素。
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** 最大宽度（px）；窄屏恒收敛为视口宽度减边距 */
    width?: number
  }>(),
  { width: 560 },
)

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()

/** 每个实例一个标题 id，保证同页面多实例的 `aria-labelledby` 不撞 */
const titleId = nextTitleId()

const dialogEl = ref<HTMLDialogElement | null>(null)
let restoreFocusTo: HTMLElement | null = null

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
  // 内容多为 `v-if="open"` 条件渲染：等一帧再聚焦标记元素
  void nextTick().then(() => {
    dialogEl.value?.querySelector<HTMLElement>('[data-autofocus]')?.focus()
  })
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

/** `cancel` 事件由 Esc 触发：阻止浏览器默认关闭，统一走 `update:open` 流程 */
function onCancel(event: Event): void {
  event.preventDefault()
  emit('update:open', false)
}

watch(
  () => props.open,
  async (isOpen) => {
    await nextTick()
    if (isOpen) openDialog()
    else closeDialog()
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
    class="base-dialog"
    :style="{ maxWidth: `${width}px` }"
    :aria-labelledby="titleId"
    @cancel="onCancel"
  >
    <form method="dialog" class="base-dialog__body" @submit.prevent>
      <h2 :id="titleId" class="base-dialog__title">{{ title }}</h2>
      <div class="base-dialog__content">
        <slot />
      </div>
      <div v-if="$slots.footer" class="base-dialog__actions">
        <slot name="footer" />
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.base-dialog {
  border: none;
  border-radius: var(--radius-lg);
  padding: 0;
  width: calc(100% - var(--space-6));
  box-shadow: 0 12px 32px rgb(15 20 30 / 24%);
  z-index: var(--z-index-dialog);
}

.base-dialog::backdrop {
  background: var(--color-overlay);
}

.base-dialog__body {
  padding: var(--space-5);
}

.base-dialog__title {
  margin: 0;
  font-size: var(--font-size-lg);
}

.base-dialog__content {
  margin-top: var(--space-4);
}

.base-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-5);
}
</style>
