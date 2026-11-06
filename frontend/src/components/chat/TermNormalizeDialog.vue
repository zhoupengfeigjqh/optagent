<script setup lang="ts">
/**
 * 术语替换确认弹窗（018）。
 *
 * 三个出口，语义与既有"发送前路由"保持一致：
 * - 「使用替换后的表述」→ `use-replacement`（携带**编辑后**的文本）
 * - 「按原话继续」（含 Esc / 遮罩 / 右上角关闭）→ `keep-original`
 * - 编辑为空 → 主按钮禁用 + 可读原因（MUST NOT 发出空消息）
 *
 * 为什么关闭一律等于"按原话"：用户点发送的意图是发送，Esc 只是不想用这一版替换文，
 * 不该把整条消息取消掉（否则还得重新输入）。
 *
 * 为什么"编辑"放在本组件内：这里是用户唯一能确认替换结果的界面，草稿属于**本弹窗的
 * 局部状态**；父级只接收"最终文本"，不需要知道用户敲了几次键盘（高内聚）。
 */
import { computed, ref, useId, watch } from 'vue'

import type { TermMatch } from '../../api/term-normalize'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** 用户原话 */
    original: string
    /** 替换后文本（编辑框的初始值） */
    normalized: string
    /** 命中明细（term → value），用于解释"改了什么" */
    matches: TermMatch[]
    /** 发送中：按钮与编辑框禁用，避免连点发两轮 / 中途改文本 */
    busy?: boolean
  }>(),
  { busy: false },
)

const emit = defineEmits<{ 'use-replacement': [text: string]; 'keep-original': [] }>()

/** 编辑草稿：初始为模型的替换结果；父级换了待确认内容时重置 */
const draft = ref(props.normalized)
watch(
  () => props.normalized,
  (value) => {
    draft.value = value
  },
)

/** 提交用的文本：与手动输入同口径（首尾空白不进入正文） */
const text = computed(() => draft.value.trim())
/** 空文本是不可提交态：按钮禁用 + 行内说明 + aria-invalid */
const isEmpty = computed(() => text.value === '')

const fieldId = `term-dialog-field-${useId()}`
const hintId = `term-dialog-hint-${useId()}`
const errorId = `term-dialog-error-${useId()}`
const describedBy = computed(() => (isEmpty.value ? `${hintId} ${errorId}` : hintId))

function submit(): void {
  if (props.busy || isEmpty.value) return
  emit('use-replacement', text.value)
}
</script>

<template>
  <BaseDialog :open="open" title="确认术语替换" @close="emit('keep-original')">
    <p :id="hintId" class="term-dialog__hint">
      识别到本体术语。使用替换后的表述能让助手更准确地理解，也可以按原话发送；下方内容可直接修改。
    </p>

    <ul v-if="matches.length > 0" class="term-dialog__matches">
      <li v-for="item in matches" :key="`${item.start}-${item.term}`" class="term-dialog__match">
        <span class="term-dialog__term">{{ item.term }}</span>
        <span aria-hidden="true">→</span>
        <span class="term-dialog__value">{{ item.value }}</span>
      </li>
    </ul>

    <section class="term-dialog__block">
      <h3 class="term-dialog__label">你的原话</h3>
      <p class="term-dialog__text">{{ original }}</p>
    </section>

    <section class="term-dialog__block">
      <label class="term-dialog__label" :for="fieldId">替换后（可编辑）</label>
      <textarea
        :id="fieldId"
        v-model="draft"
        class="term-dialog__text term-dialog__input"
        :class="{ 'term-dialog__input--invalid': isEmpty }"
        :disabled="busy"
        :aria-invalid="isEmpty ? 'true' : undefined"
        :aria-describedby="describedBy"
        rows="4"
        spellcheck="false"
      />
      <p v-if="isEmpty" :id="errorId" class="term-dialog__error" role="alert">
        替换后的内容不能为空
      </p>
    </section>

    <template #footer>
      <BaseButton variant="secondary" :disabled="busy" @click="emit('keep-original')">
        按原话继续
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="busy || isEmpty"
        :disabled-reason="isEmpty ? '替换后的内容不能为空' : null"
        @click="submit"
      >
        使用替换后的表述
      </BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.term-dialog__hint {
  margin: 0 0 var(--space-3);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.term-dialog__matches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: 0;
  list-style: none;
}

.term-dialog__match {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--color-bg-subtle);
  font-size: var(--font-size-sm);
}

.term-dialog__term {
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.term-dialog__value {
  font-weight: 600;
}

.term-dialog__block + .term-dialog__block {
  margin-top: var(--space-3);
}

.term-dialog__label {
  display: block;
  margin: 0 0 var(--space-1);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-weight: 500;
}

.term-dialog__text {
  margin: 0;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 编辑框只继承 `.term-dialog__text` 的边框与内边距，其余按表单控件形态覆盖 */
.term-dialog__input {
  display: block;
  width: 100%;
  border-color: var(--color-primary);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}

.term-dialog__input:disabled {
  color: var(--color-text-muted);
  background: var(--color-bg-subtle);
}

.term-dialog__input--invalid {
  border-color: var(--color-status-error);
}

.term-dialog__error {
  margin: var(--space-1) 0 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
}
</style>
