<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, ref, shallowRef, watch } from 'vue'

import type { InteractionSnapshot, WorkspaceFile } from '../../api/types'
import { APP_SESSION_KEY, type AppSession } from '../../composables/useAppSession'
import { createPathInsertStore } from '../../composables/usePathInsert'
import {
  createInteractionForm,
  INTERACTION_FORM_KEY,
  type InteractionFormContext,
  type InteractionFormStore,
} from '../../composables/useInteractionForm'
import { dedupeTitles } from '../../utils/arg-schema'
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'
import InteractionField from './InteractionField.vue'

const props = withDefaults(
  defineProps<{
    request: InteractionSnapshot
    serverError?: string
  }>(),
  { serverError: '' },
)

const emit = defineEmits<{
  submit: [args: Record<string, unknown>]
  reject: []
}>()

const session = inject<AppSession | null>(APP_SESSION_KEY, null)

const mention = session ? createPathInsertStore({ workspace: session.workspace }) : null

function buildForm(): InteractionFormStore {
  return createInteractionForm({
    /**
     * 同层 `title` 先去重再交给表单：重复的 title 只保留先出现的，其余回退参数名，
     * 避免两行同名让用户无法区分（`title` 的唯一性由服务端 schema 提供，这里只兜底）。
     */
    schema: dedupeTitles(props.request.schema),
    proposed: props.request.proposed_args,
    rulesField: props.request.rules_field,
    loadRules: () => {
      if (!session) throw new Error('无会话上下文，无法读取算法规则')
      return session.files.rules()
    },
  })
}

/**
 * 表单状态用 `shallowRef`：`ref` 会按 Vue 的类型规则**深层解包**对象里的 ref/computed，
 * 把 store 的 `model`/`topLevel` 类型改写成裸值，与 `InteractionFormStore` 不再兼容。
 * 这里只需要"整体替换"这一个语义，浅引用即可。
 */
const form = shallowRef<InteractionFormStore>(buildForm())
const topLevel = computed(() => form.value.topLevel.value)
const actionError = computed(() => form.value.actionError.value)

const fileIndex = computed(() => {
  const map = new Map<string, { dir: string; file: WorkspaceFile }>()
  if (!session) return map
  for (const dir of session.workspace.dirs.value) {
    for (const file of dir.files) {
      map.set(`${dir.dir}/${file.filename}`, { dir: dir.dir, file })
    }
  }
  return map
})

/**
 * 递归字段组件共享的上下文。用取值器（getter）而非快照：
 * 挂起点变化时 `form` 会整体重建，字段组件必须读到**新的**那一份。
 */
const context: InteractionFormContext = {
  get form(): InteractionFormStore {
    return form.value
  },
  mention,
  get fileIndex(): Map<string, { dir: string; file: WorkspaceFile }> {
    return fileIndex.value
  },
}
provide(INTERACTION_FORM_KEY, context)

function onReject(): void {
  emit('reject')
}

function onSubmit(): void {
  const error = form.value.validate()
  if (error !== '') {
    localError.value = error
    return
  }
  localError.value = ''
  emit('submit', form.value.build())
}

const localError = ref('')
const remaining = ref(props.request.remaining_seconds)
let timer: ReturnType<typeof setInterval> | null = null

// `immediate`：挂载即预取文件空间，否则首屏的结构化卡片与 @ 面板都没有数据源。
watch(
  () => props.request.interaction_id,
  () => {
    form.value = buildForm()
    mention?.reset()
    localError.value = ''
    if (session && !session.workspace.loading.value) {
      void session.workspace.load()
    }
  },
  { immediate: true },
)

watch(
  () => props.request.interaction_id,
  () => {
    remaining.value = props.request.remaining_seconds
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      remaining.value -= 1
      if (remaining.value <= 0 && timer) {
        clearInterval(timer)
        timer = null
        emit('reject')
      }
    }, 1000)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <BaseDialog :open="true" :title="request.title" @close="onReject">
    <template #header-extra>
      <span class="interaction-dialog__countdown">剩余 {{ remaining }} 秒</span>
    </template>

    <div class="interaction-dialog">
      <p v-if="topLevel.length === 0" class="interaction-dialog__empty">
        该调用无需填写参数，请确认是否执行。
      </p>

      <InteractionField
        v-for="field in topLevel"
        :key="field.key"
        :schema="field.schema"
        :path="[field.key]"
        :name="field.key"
        :required="field.required"
      />

      <p v-if="localError" class="interaction-dialog__error">{{ localError }}</p>
      <p v-if="actionError" class="interaction-dialog__error">{{ actionError }}</p>
      <p v-if="serverError" class="interaction-dialog__error">{{ serverError }}</p>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="onReject">拒绝调用</BaseButton>
      <BaseButton variant="primary" @click="onSubmit">确认提交</BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.interaction-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.interaction-dialog__countdown {
  flex: none;
  white-space: nowrap;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.interaction-dialog__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.interaction-dialog__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
  white-space: pre-line;
}
</style>
