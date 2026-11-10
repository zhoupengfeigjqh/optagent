<script setup lang="ts">
/**
 * 用户编辑器（`FR-024`、`FR-025`）：新建/编辑用户、增加或移除关联数字人。
 *
 * 可关联的 MUST 是平台内**已存在**的数字人（`FR-025`），故这里只提供勾选，
 * 不提供自由输入。
 *
 * 2026-11-10：由「内联展开的 section」改为**弹窗**（`BaseDialog`）。理由：它承载的是
 * 一次完整的编辑会话（改用户标识 + 重排关联 + 保存/取消），内联展开会把卡片列表整体
 * 向下挤，且与"点卡片上的按钮 → 针对该卡片编辑"的心智不符；弹窗的焦点陷阱与 Esc
 * 关闭也让键盘操作路径与其它弹窗（删除/撤回/新建服务）一致。
 */
import { computed, ref, watch } from 'vue'
import type { AgentListItem, UserListItem } from '../../api/types'
import BaseDialog from '../common/BaseDialog.vue'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  open: boolean
  /** 编辑既有用户时传入；新建为 null */
  user: UserListItem | null
  agents: AgentListItem[]
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', payload: { user_id: string; agents: string[] }): void
}>()

const userId = ref('')
const selected = ref<string[]>([])

// `immediate`：允许"挂载即打开"（如从别的入口直接唤起），否则初始值不会被灌入
watch(
  () => props.open,
  (open) => {
    if (!open) return
    userId.value = props.user?.user_id ?? ''
    selected.value = props.user?.agents.map((a) => a.name) ?? []
  },
  { immediate: true },
)

const isEdit = computed(() => props.user !== null)
const title = computed(() => (isEdit.value ? `编辑用户：${props.user?.user_id}` : '新建用户'))
const options = computed<CheckboxOption[]>(() =>
  props.agents.map((agent) => ({
    value: agent.name,
    label: agent.name,
    description: agent.description || '（无描述）',
    badge: agent.abnormal ? '异常' : undefined,
  })),
)

function submit(): void {
  emit('submit', { user_id: userId.value, agents: [...selected.value] })
}
</script>

<template>
  <BaseDialog :open="open" :title="title" :width="640" @update:open="emit('update:open', $event)">
    <template v-if="open">
      <label v-if="!isEdit" class="field user-editor__field" for="user-id">
        <span class="field__label">
          用户标识<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input id="user-id" v-model="userId" type="text" placeholder="例如：admin" data-autofocus />
        <span class="field__hint">对应运行环境的 users/ 目录名，不得含路径分隔符或 “..”。</span>
      </label>
      <p v-else class="field__hint">用户标识不可修改（它是运行环境数据目录的划分依据）。</p>

      <CheckboxList
        class="user-editor__list"
        legend="关联的数字人"
        :options="options"
        :model-value="selected"
        search-placeholder="按数字人名或描述搜索…"
        empty-text="还没有可关联的数字人（请先在数字人设计功能区内创建）"
        @update:model-value="selected = $event"
      />
    </template>

    <template #footer>
      <button type="button" class="btn" @click="emit('update:open', false)">取消</button>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
        {{ busy ? '保存中…' : '保存' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.user-editor__field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}

.user-editor__list {
  margin-top: var(--space-1);
}
</style>
