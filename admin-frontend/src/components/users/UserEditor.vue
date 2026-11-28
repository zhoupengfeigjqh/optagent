<script setup lang="ts">
/**
 * 新建账户弹窗（**只用于新建**，2026-11-27）。
 *
 * 「修改」入口已从用户列表移除：账户扩展字段（手机号 / 用户名 / 角色）只在建号时设定，
 * 数字人授权改由「授权详情」勾选（授权 = 关联）。因此这里不再有编辑态分支，
 * 避免两套"改关联"的写入路径互相打架、也避免同一表单在两处语义不同。
 */
import { computed, ref, watch } from 'vue'
import type { AgentListItem } from '../../api/types'
import { passwordError as validatePasswordLength } from '../../utils/password'
import { isPhone } from '../../utils/phone'
import { agentCheckboxOptions } from '../agents/agent-options'
import BaseDialog from '../common/BaseDialog.vue'
import CheckboxList from '../common/CheckboxList.vue'

/** 用户标识校验（与后端 `isSafeName` 同口径，避免前后端错位） */
function validateUserId(value: string): string {
  if (value.length === 0) return '用户标识必填'
  if (value.length > 64) return '用户标识最长 64 个字符'
  if (value === '.' || value === '..') return '用户标识不能为 "." 或 ".."'
  if (/[/\\]/.test(value)) return '用户标识不得含路径分隔符'
  if (value.includes('..')) return '用户标识不得含 ".."'
  return ''
}

const props = defineProps<{
  open: boolean
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
      password: string
      phone?: string
      display_name?: string
      role: 'admin' | 'user'
    },
  ): void
}>()

const userId = ref('')
/** 初始授权（= 初始关联；建号后仍可在「授权详情」里调整） */
const selected = ref<string[]>([])
const password = ref('')
const passwordError = ref('')
const phone = ref('')
const displayName = ref('')
const role = ref<'admin' | 'user'>('user')
const phoneError = ref('')
const userIdError = ref('')

// `immediate`：允许"挂载即打开"，否则初始值不会被灌入
watch(
  () => props.open,
  (open) => {
    if (!open) return
    userId.value = ''
    selected.value = []
    password.value = ''
    passwordError.value = ''
    phone.value = ''
    displayName.value = ''
    role.value = 'user'
    phoneError.value = ''
    userIdError.value = ''
  },
  { immediate: true },
)

const options = computed(() => agentCheckboxOptions(props.agents))

function submit(): void {
  passwordError.value = ''
  phoneError.value = ''
  userIdError.value = validateUserId(userId.value)
  if (userIdError.value) return
  // 新建时必填初始密码（否则该账号无法登录，见 FR-001/FR-013）
  const passwordIssue = validatePasswordLength(password.value)
  if (passwordIssue) {
    passwordError.value = passwordIssue
    return
  }
  // 028：手机号可选，但填了必须合法（登录标识，注册后可用手机号登录）
  if (phone.value.trim() !== '' && !isPhone(phone.value)) {
    phoneError.value = '手机号须为 1 开头的 11 位数字'
    return
  }
  emit('submit', {
    user_id: userId.value,
    agents: [...selected.value],
    password: password.value,
    ...(phone.value.trim() === '' ? {} : { phone: phone.value.trim() }),
    ...(displayName.value.trim() === '' ? {} : { display_name: displayName.value.trim() }),
    role: role.value,
  })
}
</script>

<template>
  <BaseDialog :open="open" title="新建用户" :width="640" @update:open="emit('update:open', $event)">
    <template v-if="open">
      <label class="field user-editor__field" for="user-id">
        <span class="field__label">
          用户标识<span class="field__required" aria-hidden="true">*</span>
        </span>
        <input id="user-id" v-model="userId" type="text" placeholder="例如：admin" data-autofocus />
        <span v-if="userIdError" class="field__hint" role="alert" style="color: #c00">
          {{ userIdError }}
        </span>
        <span v-else class="field__hint">对应运行环境的 users/ 目录名，不得含路径分隔符或 “..”。</span>
      </label>

      <label class="field user-editor__field" for="user-password">
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

      <label class="field user-editor__field" for="user-phone">
        <span class="field__label">手机号（可选）</span>
        <input id="user-phone" v-model="phone" type="tel" placeholder="13800000000" />
        <span class="field__hint">设置后可用手机号代替用户标识登录。</span>
        <span v-if="phoneError" class="field__hint" role="alert" style="color: #c00">
          {{ phoneError }}
        </span>
      </label>

      <label class="field user-editor__field" for="user-display-name">
        <span class="field__label">用户名（可选）</span>
        <input id="user-display-name" v-model="displayName" type="text" placeholder="如 张三" />
      </label>

      <label class="field user-editor__field" for="user-role">
        <span class="field__label">角色</span>
        <select id="user-role" v-model="role">
          <option value="user">普通用户</option>
          <option value="admin">管理员</option>
        </select>
        <span class="field__hint">管理员可登录本管理台；普通用户只能通过专属注册链接进入前台。</span>
      </label>

      <CheckboxList
        class="user-editor__list"
        legend="初始授权（勾选即关联该数字人）"
        :options="options"
        :model-value="selected"
        search-placeholder="按数字人名或描述搜索…"
        empty-text="还没有可授权的数字人（请先在数字人设计功能区内创建）"
        @update:model-value="selected = $event"
      />
      <p class="user-editor__hint">保存后仍需在列表中点击该账户的「部署」，数字人才会下发到运行环境。</p>
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

.user-editor__hint {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
