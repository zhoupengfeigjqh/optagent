<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AgentListItem, UserListItem } from '../../api/types'
import BaseDialog from '../common/BaseDialog.vue'
import CheckboxList from '../common/CheckboxList.vue'
import type { CheckboxOption } from '../common/checkbox-option'

const props = defineProps<{
  open: boolean
  user: UserListItem | null
  agents: AgentListItem[]
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (
    e: 'submit',
    payload: {
      user_id: string
      agents: string[]
      password?: string
      phone?: string
      display_name?: string
      role?: 'admin' | 'user'
    },
  ): void
}>()

const userId = ref('')
const selected = ref<string[]>([])
const password = ref('')
const passwordError = ref('')
/** 028：新建时的账号扩展字段（编辑态不可改——后端 PUT 只接受 agents） */
const phone = ref('')
const displayName = ref('')
const role = ref<'admin' | 'user'>('user')
const phoneError = ref('')

// `immediate`：允许"挂载即打开"（如从别的入口直接唤起），否则初始值不会被灌入
watch(
  () => props.open,
  (open) => {
    if (!open) return
    userId.value = props.user?.user_id ?? ''
    selected.value = props.user?.agents.map((a) => a.name) ?? []
    password.value = ''
    passwordError.value = ''
    phone.value = props.user?.phone ?? ''
    displayName.value = props.user?.display_name ?? ''
    role.value = props.user?.role ?? 'user'
    phoneError.value = ''
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
  passwordError.value = ''
  phoneError.value = ''
  if (!isEdit.value) {
    // 新建时必填初始密码（否则该账号无法登录，见 FR-001/FR-013）
    if (password.value.length < 6 || password.value.length > 128) {
      passwordError.value = '密码长度须为 6~128 个字符'
      return
    }
    // 028：手机号可选，但填了必须合法（登录标识，注册后可用手机号登录）
    if (phone.value !== '' && !/^1\d{10}$/.test(phone.value.trim())) {
      phoneError.value = '手机号须为 1 开头的 11 位数字'
      return
    }
  }
  emit('submit', {
    user_id: userId.value,
    agents: [...selected.value],
    ...(isEdit.value ? {} : { password: password.value }),
    ...(isEdit.value || phone.value.trim() === '' ? {} : { phone: phone.value.trim() }),
    ...(isEdit.value || displayName.value.trim() === '' ? {} : { display_name: displayName.value.trim() }),
    ...(isEdit.value ? {} : { role: role.value }),
  })
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

      <label v-if="!isEdit" class="field user-editor__field" for="user-password">
        <span class="field__label">
          初始密码<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input
          id="user-password"
          v-model="password"
          type="password"
          autocomplete="new-password"
          placeholder="至少 6 个字符"
        />
        <span class="field__hint">用户用它登录聊天前台；仅在新建时设置。</span>
        <span v-if="passwordError" class="field__hint" role="alert" style="color: #c00">
          {{ passwordError }}
        </span>
      </label>

      <label v-if="!isEdit" class="field user-editor__field" for="user-phone">
        <span class="field__label">手机号（可选）</span>
        <input id="user-phone" v-model="phone" type="tel" placeholder="13800000000" />
        <span class="field__hint">设置后可用手机号代替用户标识登录。</span>
        <span v-if="phoneError" class="field__hint" role="alert" style="color: #c00">
          {{ phoneError }}
        </span>
      </label>

      <label v-if="!isEdit" class="field user-editor__field" for="user-display-name">
        <span class="field__label">用户名（可选）</span>
        <input id="user-display-name" v-model="displayName" type="text" placeholder="如 张三" />
      </label>

      <label v-if="!isEdit" class="field user-editor__field" for="user-role">
        <span class="field__label">角色</span>
        <select id="user-role" v-model="role">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <span class="field__hint">管理员角色在阶段 4（管理台鉴权）后生效。</span>
      </label>

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
