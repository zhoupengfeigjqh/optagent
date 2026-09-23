<script setup lang="ts">
/**
 * 工具调用人工确认弹窗（HITL，Schema 驱动通用表单）。
 *
 * 解耦红线：本组件**唯一输入**是 `request`（title + schema + proposed_args + rules_field），
 * 不含任何具体工具/MCP 服务名；新增需确认的工具 = 平台改配置 + 部署，零代码。
 *
 * 分层（2026-09-23 起）：
 * - 控件推导与值逻辑：`utils/arg-schema.ts` / `utils/arg-values.ts`（纯函数，各自有单测）；
 * - 表单状态：`composables/useInteractionForm.ts`（模型 / JSON 草稿 / 规则入口落点）；
 * - 单个字段（含任意深度递归）：`InteractionField.vue`；
 * - 本组件只做弹窗外壳：标题、倒计时、错误汇总、提交与拒绝。
 *
 * 倒计时：`remaining_seconds` 归零 → 按拒绝关闭（后端超时同样按拒绝收尾，语义一致）。
 */
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
import BaseButton from '../common/BaseButton.vue'
import BaseDialog from '../common/BaseDialog.vue'
import HintTip from '../common/HintTip.vue'
import InteractionField from './InteractionField.vue'

const props = withDefaults(
  defineProps<{
    /** 待确认的交互（含预填参数、schema、规则字段、剩余秒数） */
    request: InteractionSnapshot
    /** 服务端终验失败的逐字段错误（上层经 submit 结果回写；非空时保持弹窗） */
    serverError?: string
  }>(),
  { serverError: '' },
)

const emit = defineEmits<{
  submit: [args: Record<string, unknown>]
  reject: []
}>()

/**
 * 会话上下文可选注入：弹窗在无会话环境（单测/独立挂载）下退化为纯表单
 * （无 @ 引用、无文件卡片、无规则入口），确认/拒绝主流程不受影响。
 */
const session = inject<AppSession | null>(APP_SESSION_KEY, null)

/** `@` 路径插入状态机（无会话不创建）。 */
const mention = session ? createPathInsertStore({ workspace: session.workspace }) : null

/** 构造一份与当前快照对应的表单状态（挂起点变化时整体重建）。 */
function buildForm(): InteractionFormStore {
  return createInteractionForm({
    schema: props.request.schema,
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

/** 文件空间反查索引：user-data 相对路径 → 文件（结构化卡片的展示层数据源）。 */
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

/* ---------- 倒计时：归零按拒绝关闭 ---------- */

const localError = ref('')
const remaining = ref(props.request.remaining_seconds)
let timer: ReturnType<typeof setInterval> | null = null

// 新挂起点 / 恢复快照：重置表单与 @ 面板，并刷新文件空间（命中预填路径的字段要出结构化卡片）。
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
    <div class="interaction-dialog">
      <p class="interaction-dialog__meta">
        <span class="interaction-dialog__tool">
          工具：<code>{{ request.tool_name }}</code>
          <!-- 工具级说明（schema 的 description）收进「?」：默认不占版面 -->
          <HintTip
            v-if="request.tool_description"
            :text="request.tool_description"
            label="查看工具说明"
          />
        </span>
        <span class="interaction-dialog__countdown">剩余 {{ remaining }} 秒</span>
      </p>

      <p v-if="topLevel.length === 0" class="interaction-dialog__empty">
        该调用无需填写参数，请确认是否执行。
      </p>

      <!-- 顶层字段逐个成行；嵌套结构由 InteractionField 递归展开 -->
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

.interaction-dialog__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.interaction-dialog__meta code {
  font-family: monospace;
}

.interaction-dialog__countdown {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.interaction-dialog__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

/* 工具名与「?」同一行（提示贴着它要解释的东西） */
.interaction-dialog__tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}

.interaction-dialog__error {
  margin: 0;
  color: var(--color-status-error);
  font-size: var(--font-size-sm);
  white-space: pre-line;
}
</style>
