<script setup lang="ts">
/**
 * 用户编辑器（`FR-024`、`FR-025`）：新建/编辑用户、增加或移除关联数字人。
 *
 * 可关联的 MUST 是平台内**已存在**的数字人（`FR-025`），故这里只提供勾选，
 * 不提供自由输入。
 */
import { computed, ref, watch } from 'vue'
import type { AgentListItem, UserListItem } from '../../api/types'
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

watch(
  () => props.open,
  (open) => {
    if (!open) return
    userId.value = props.user?.user_id ?? ''
    selected.value = props.user?.agents.map((a) => a.name) ?? []
  },
)

const isEdit = computed(() => props.user !== null)
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
  <section v-if="open" class="user-editor" aria-label="用户与关联数字人">
    <h3 class="user-editor__title">{{ isEdit ? `编辑用户：${user?.user_id}` : '新建用户' }}</h3>

    <label v-if="!isEdit" class="field" for="user-id">
      <span class="field__label">
        用户标识<span class="field__required" aria-hidden="true">*</span>
      </span>
      <input id="user-id" v-model="userId" type="text" placeholder="例如：admin" />
      <span class="field__hint">对应运行环境的 users/ 目录名，不得含路径分隔符或 “..”。</span>
    </label>
    <p v-else class="field__hint">用户标识不可修改（它是运行环境数据目录的划分依据）。</p>

    <CheckboxList
      legend="关联的数字人"
      :options="options"
      :model-value="selected"
      search-placeholder="按数字人名或描述搜索…"
      empty-text="还没有可关联的数字人（请先在数字人设计功能区内创建）"
      @update:model-value="selected = $event"
    />

    <div class="user-editor__actions">
      <button type="button" class="btn" @click="emit('update:open', false)">取消</button>
      <button type="button" class="btn btn--primary" :disabled="busy" @click="submit">
        {{ busy ? '保存中…' : '保存' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.user-editor {
  padding: var(--space-4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-subtle);
  margin-bottom: var(--space-4);
}

.user-editor__title {
  margin: 0 0 var(--space-3);
  font-size: var(--font-size-md);
}

.user-editor__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
</style>
