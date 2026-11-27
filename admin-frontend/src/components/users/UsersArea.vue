<script setup lang="ts">
/**
 * 用户管理：账户搜索、授权状态筛选、账户维护和授权详情。
 *
 * 后端目前只提供账户未分页筛选，因此搜索与状态筛选作用于当前页；
 * 新建/修改复用平台已有的用户编辑器与全局配置版本号。
 */
import { computed, onMounted, ref } from 'vue'
import { listAgentServices } from '../../api/account'
import { listAgents } from '../../api/agents'
import { fetchManifest } from '../../api/deploy'
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser,
} from '../../api/users'
import type {
  AgentListItem,
  AgentServiceItem,
  ErrorInfo,
  Paged,
  UserListItem,
} from '../../api/types'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import ResetPasswordDialog from '../deploy/ResetPasswordDialog.vue'
import UserEditor from '../deploy/UserEditor.vue'
import GrantDetailDialog from './GrantDetailDialog.vue'
import UserAccountTable from './UserAccountTable.vue'

type GrantFilter = 'all' | 'approved' | 'pending'

const page = ref(1)
const pageData = ref<Paged<UserListItem> | null>(null)
const services = ref<AgentServiceItem[]>([])
const agents = ref<AgentListItem[]>([])
const loading = ref(false)
const loadError = ref<ErrorInfo | null>(null)
const actionError = ref<ErrorInfo | null>(null)

const search = ref('')
const grantFilter = ref<GrantFilter>('all')

const editorOpen = ref(false)
const editingUser = ref<UserListItem | null>(null)
const editorBusy = ref(false)

const grantUser = ref<UserListItem | null>(null)
const resetUser = ref<UserListItem | null>(null)
const resetBusy = ref(false)
const resetError = ref<ErrorInfo | null>(null)
const deleteTarget = ref<UserListItem | null>(null)

const emit = defineEmits<{
  (e: 'announce', text: string): void
}>()

const visibleUsers = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  return (pageData.value?.items ?? []).filter((user) => {
    const matchesKeyword =
      keyword === '' ||
      (user.phone ?? '').includes(keyword) ||
      (user.display_name ?? '').toLowerCase().includes(keyword) ||
      user.user_id.toLowerCase().includes(keyword)
    if (!matchesKeyword) return false
    if (grantFilter.value === 'approved') return (user.grants_summary?.approved ?? 0) > 0
    if (grantFilter.value === 'pending') return (user.grants_summary?.pending ?? 0) > 0
    return true
  })
})

const hasFilter = computed(() => search.value.trim() !== '' || grantFilter.value !== 'all')

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    pageData.value = await listUsers(page.value, false)
  } catch (err) {
    loadError.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 用户编辑器需要完整数字人清单；接口每页 8 条，这里按页取完。 */
async function loadAllAgents(): Promise<AgentListItem[]> {
  const first = await listAgents(1)
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, index) =>
      listAgents(index + 2),
    ),
  )
  return [first, ...rest].flatMap((item) => item.items)
}

async function openEditor(user: UserListItem | null): Promise<void> {
  actionError.value = null
  try {
    agents.value = await loadAllAgents()
    editingUser.value = user
    editorOpen.value = true
  } catch (err) {
    actionError.value = err as ErrorInfo
  }
}

async function submitEditor(payload: {
  user_id: string
  agents: string[]
  password?: string
  phone?: string
  display_name?: string
  role?: 'admin' | 'user'
}): Promise<void> {
  editorBusy.value = true
  actionError.value = null
  try {
    if (editingUser.value) {
      const { revision } = await fetchManifest()
      await updateUser(editingUser.value.user_id, payload.agents, revision)
      emit('announce', `用户 ${editingUser.value.user_id} 已更新`)
    } else {
      await createUser(payload.user_id, payload.agents, payload.password, {
        ...(payload.phone ? { phone: payload.phone } : {}),
        ...(payload.display_name ? { display_name: payload.display_name } : {}),
        ...(payload.role ? { role: payload.role } : {}),
      })
      emit('announce', `用户 ${payload.user_id} 已创建`)
    }
    editorOpen.value = false
    await load()
  } catch (err) {
    actionError.value = err as ErrorInfo
  } finally {
    editorBusy.value = false
  }
}

function openReset(user: UserListItem): void {
  resetError.value = null
  resetUser.value = user
}

async function submitReset(password: string): Promise<void> {
  if (!resetUser.value) return
  resetBusy.value = true
  resetError.value = null
  try {
    await resetUserPassword(resetUser.value.user_id, password)
    emit('announce', `用户 ${resetUser.value.user_id} 的密码已重置`)
    resetUser.value = null
  } catch (err) {
    resetError.value = err as ErrorInfo
  } finally {
    resetBusy.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleteTarget.value) return
  actionError.value = null
  try {
    await deleteUser(deleteTarget.value.user_id)
    emit('announce', `用户 ${deleteTarget.value.user_id} 已删除`)
    deleteTarget.value = null
    await load()
  } catch (err) {
    actionError.value = err as ErrorInfo
  }
}

function clearFilter(): void {
  search.value = ''
  grantFilter.value = 'all'
}

onMounted(() => {
  void load()
  void listAgentServices()
    .then((result) => {
      services.value = result.items
    })
    .catch((err: unknown) => {
      actionError.value = err as ErrorInfo
    })
})
</script>

<template>
  <section class="users-area">
    <div class="users-area__head">
      <div>
        <h2>账户管理</h2>
        <p>共 {{ pageData?.total ?? 0 }} 个账户</p>
      </div>
      <button type="button" class="btn btn--primary" @click="openEditor(null)">
        新建用户
      </button>
    </div>

    <div class="users-area__filter">
      <label>
        <span>搜索账户</span>
        <input v-model="search" type="search" placeholder="手机号 / 用户名" />
      </label>
      <label>
        <span>授权状态</span>
        <select v-model="grantFilter">
          <option value="all">全部</option>
          <option value="approved">含已授权</option>
          <option value="pending">含申请中</option>
        </select>
      </label>
    </div>

    <div v-if="hasFilter" class="users-area__scope">
      <span>
        当前页筛选后显示 {{ visibleUsers.length }} 个账户；搜索与筛选仅作用于当前页。
      </span>
      <button type="button" class="btn btn--small" @click="clearFilter">清除筛选</button>
    </div>

    <ErrorNotice v-if="actionError" :error="actionError" title="操作未完成" />
    <UserAccountTable
      :items="visibleUsers"
      :services="services"
      :total="pageData?.total ?? 0"
      :page="page"
      :page-size="pageData?.page_size ?? 8"
      :loading="loading"
      :error="loadError"
      @update:page="
        (next) => {
          page = next
          void load()
        }
      "
      @grants="grantUser = $event"
      @edit="openEditor($event)"
      @reset-password="openReset"
      @delete="deleteTarget = $event"
    />

    <p class="users-area__hint">
      通过专属注册链接注册成功后，用户自动获得对应数字人权限；只有从对话界面提交的其他
      数字人申请才需要在这里审批。
    </p>

    <UserEditor
      v-model:open="editorOpen"
      :user="editingUser"
      :agents="agents"
      :busy="editorBusy"
      @submit="submitEditor"
    />
    <GrantDetailDialog
      :open="grantUser !== null"
      :user="grantUser"
      @update:open="
        (value) => {
          if (!value) grantUser = null
        }
      "
      @changed="load"
      @announce="emit('announce', $event)"
    />
    <ResetPasswordDialog
      :open="resetUser !== null"
      :user-id="resetUser?.user_id ?? ''"
      :busy="resetBusy"
      :error="resetError"
      @update:open="
        (value) => {
          if (!value) resetUser = null
        }
      "
      @submit="submitReset"
    />
    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删除账户"
      :message="`确认删除账户「${deleteTarget?.display_name || deleteTarget?.user_id || ''}」？删除后其注册信息与全部授权记录将一并移除。`"
      confirm-label="确认删除"
      danger
      @update:open="
        (value) => {
          if (!value) deleteTarget = null
        }
      "
      @confirm="confirmDelete"
    />
  </section>
</template>

<style scoped>
.users-area__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-wrap: wrap;
  margin-bottom: var(--space-4);
}

.users-area__head h2 {
  margin: 0;
  font-size: 17px;
}

.users-area__head p {
  margin: 2px 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.users-area__filter {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
}

.users-area__filter label {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.users-area__filter label > span {
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
}

.users-area__filter input,
.users-area__filter select {
  width: 210px;
  height: 36px;
  padding: 0 10px;
  font-size: var(--font-size-md);
}

.users-area__scope {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  margin-bottom: var(--space-3);
  padding: 8px 12px;
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-sm);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-sm);
}

.users-area__hint {
  margin: var(--space-4) 0 0;
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-sm);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-xs);
  line-height: 1.7;
}

@media (max-width: 640px) {
  .users-area__filter input,
  .users-area__filter select {
    width: min(100%, 260px);
  }
}
</style>
