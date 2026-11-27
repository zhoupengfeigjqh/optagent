<script setup lang="ts">
/**
 * 用户管理：账户搜索、授权筛选、账户维护、授权详情与部署。
 *
 * 口径（2026-11-27 收敛后）：
 *  - **授权 = 关联**：`agents[]` 既是已授权的数字人，也是待部署的清单；
 *  - **部署** 是本页的行内动作（一次一个账户），下发后运行环境才生效；
 *  - **修改** 入口已删除：账户扩展字段只在新建时设置，数字人授权在「授权详情」里勾选；
 *  - 后端只提供未分页的账户列表，所以搜索与筛选作用于当前页。
 */
import { computed, onMounted, ref } from 'vue'
import { listAgentServices } from '../../api/account'
import { listAllAgents } from '../../api/agents'
import { deployUsers, withdrawUser } from '../../api/deploy'
import { fetchManifest } from '../../api/manifest'
import { createUser, deleteUser, listUsers, resetUserPassword } from '../../api/users'
import type { AgentListItem, AgentServiceItem, ErrorInfo, Paged, UserListItem } from '../../api/types'
import { toErrorInfo } from '../../utils/error-message'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import GrantDetailDialog from './GrantDetailDialog.vue'
import ResetPasswordDialog from './ResetPasswordDialog.vue'
import UserAccountTable from './UserAccountTable.vue'
import UserEditor from './UserEditor.vue'

/** 授权筛选：只有"已授权/未授权"两态（授权 = 是否在 `agents[]` 里，没有待审批态） */
type AuthFilter = 'all' | 'authorized' | 'unauthorized'

const page = ref(1)
const pageData = ref<Paged<UserListItem> | null>(null)
const services = ref<AgentServiceItem[]>([])
const agents = ref<AgentListItem[]>([])
const loading = ref(false)
const loadError = ref<ErrorInfo | null>(null)
const actionError = ref<ErrorInfo | null>(null)

const search = ref('')
const authFilter = ref<AuthFilter>('all')

const editorOpen = ref(false)
const editorBusy = ref(false)

const grantUser = ref<UserListItem | null>(null)
const resetUser = ref<UserListItem | null>(null)
const resetBusy = ref(false)
const resetError = ref<ErrorInfo | null>(null)
const deleteTarget = ref<UserListItem | null>(null)
/** 待二次确认的部署目标（点击「部署」只打开确认弹窗，不立即下发） */
const deployTarget = ref<UserListItem | null>(null)
/** 待二次确认的停止目标（撤回部署） */
const withdrawTarget = ref<UserListItem | null>(null)
/** 正在部署的账户（空 = 无部署进行中） */
const deployingUserId = ref<string | null>(null)
/** 正在停止（撤回部署）的账户（空 = 无停止进行中） */
const withdrawingUserId = ref<string | null>(null)

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
    if (authFilter.value === 'authorized') return user.agents.length > 0
    if (authFilter.value === 'unauthorized') return user.agents.length === 0
    return true
  })
})

const hasFilter = computed(() => search.value.trim() !== '' || authFilter.value !== 'all')

async function load(): Promise<void> {
  loading.value = true
  loadError.value = null
  try {
    pageData.value = await listUsers(page.value)
  } catch (err) {
    loadError.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 新建账户：编辑器需要完整数字人清单作为"初始授权"候选 */
async function openEditor(): Promise<void> {
  actionError.value = null
  try {
    agents.value = await listAllAgents()
    editorOpen.value = true
  } catch (err) {
    actionError.value = toErrorInfo(err)
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
    await createUser(payload.user_id, payload.agents, payload.password, {
      ...(payload.phone ? { phone: payload.phone } : {}),
      ...(payload.display_name ? { display_name: payload.display_name } : {}),
      ...(payload.role ? { role: payload.role } : {}),
    })
    emit('announce', `用户 ${payload.user_id} 已创建；点击其「部署」后生效`)
    editorOpen.value = false
    await load()
  } catch (err) {
    actionError.value = toErrorInfo(err)
  } finally {
    editorBusy.value = false
  }
}

/** 点击「部署」：只打开二次确认弹窗，不立即下发（部署会整体覆盖运行环境配置） */
function requestDeploy(user: UserListItem): void {
  actionError.value = null
  deployTarget.value = user
}

/**
 * 确认部署。
 *
 * `ConfirmDialog` 在 `emit('confirm')` 之后会**立即**把 `open` 置 false，
 * 父组件随之把 `deployTarget` 清空，因此必须先取快照（与删除同口径）。
 */
async function confirmDeploy(): Promise<void> {
  const target = deployTarget.value
  deployTarget.value = null
  if (!target) return
  await deployUser(target)
}

/**
 * 部署该账户**已授权**的数字人（一次一个账户）。
 *
 * 版本号从部署清单现取现用：授权刚变更过就换版本，用旧版本会 409。
 * 部署是整体覆盖语义——取消授权的数字人目录会被清掉，文件空间不动。
 */
async function deployUser(user: UserListItem): Promise<void> {
  if (deployingUserId.value !== null) return
  deployingUserId.value = user.user_id
  actionError.value = null
  try {
    const { revision } = await fetchManifest()
    const result = await deployUsers([user.user_id], revision)
    const outcome = result.users.find((item) => item.user_id === user.user_id)
    if (!outcome || !outcome.ok) {
      emit('announce', `用户 ${user.user_id} 部署失败：${outcome?.error ?? '未返回结果'}`)
    } else {
      const written = outcome.agents.filter((agent) => agent.action === 'written').length
      const removed = outcome.agents.filter((agent) => agent.action === 'removed').length
      emit('announce', `用户 ${user.user_id} 部署完成：写入 ${written} 个、移除 ${removed} 个数字人`)
    }
    await load()
  } catch (err) {
    actionError.value = toErrorInfo(err)
  } finally {
    deployingUserId.value = null
  }
}

/** 点击「停止」：二次确认后撤回该账户在运行环境中的全部数字人副本 */
function requestWithdraw(user: UserListItem): void {
  actionError.value = null
  withdrawTarget.value = user
}

/**
 * 确认停止（撤回部署，契约 §6.9）。
 *
 * 只动运行环境：授权（`agents[]`）与文件空间（`user-data/**`）保留；撤回后
 * `my-agents` 为空，该用户立即无法使用，重新部署即可恢复。
 */
async function confirmWithdraw(): Promise<void> {
  const target = withdrawTarget.value
  withdrawTarget.value = null
  if (!target || withdrawingUserId.value !== null) return
  withdrawingUserId.value = target.user_id
  actionError.value = null
  try {
    const { revision } = await fetchManifest()
    const result = await withdrawUser(target.user_id, revision)
    emit(
      'announce',
      `用户 ${target.user_id} 已停止：撤回 ${result.withdrawn.length} 个数字人副本，` +
        '授权与文件空间保留，重新部署即可恢复',
    )
    await load()
  } catch (err) {
    actionError.value = toErrorInfo(err)
  } finally {
    withdrawingUserId.value = null
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
    resetError.value = toErrorInfo(err)
  } finally {
    resetBusy.value = false
  }
}

async function confirmDelete(): Promise<void> {
  // `ConfirmDialog` 在 `emit('confirm')` 之后会**立即** `emit('update:open', false)`，
  // 父组件随之把 `deleteTarget` 置 null。因此必须先取快照，await 之后不得再读 `deleteTarget.value`
  // ——否则会抛 `Cannot read properties of null`，且该 TypeError 无错误码，
  // 界面只会显示兜底的「请求失败，请稍后重试」，删除其实已成功（历史缺陷）。
  const target = deleteTarget.value
  if (!target) return
  actionError.value = null
  try {
    await deleteUser(target.user_id)
    deleteTarget.value = null
    emit('announce', `用户 ${target.user_id} 已删除`)
    await load()
  } catch (err) {
    actionError.value = toErrorInfo(err)
  }
}

function clearFilter(): void {
  search.value = ''
  authFilter.value = 'all'
}

onMounted(() => {
  void load()
  void listAgentServices()
    .then((result) => {
      services.value = result.items
    })
    .catch((err: unknown) => {
      actionError.value = toErrorInfo(err)
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
      <button type="button" class="btn btn--primary" @click="openEditor()">新建用户</button>
    </div>

    <div class="users-area__filter">
      <label>
        <span>搜索账户</span>
        <input v-model="search" type="search" placeholder="手机号 / 用户名" />
      </label>
      <label>
        <span>授权状态</span>
        <select v-model="authFilter">
          <option value="all">全部</option>
          <option value="authorized">已授权</option>
          <option value="unauthorized">未授权</option>
        </select>
      </label>
    </div>

    <div v-if="hasFilter" class="users-area__scope">
      <span> 当前页筛选后显示 {{ visibleUsers.length }} 个账户；搜索与筛选仅作用于当前页。 </span>
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
      :deploying-user-id="deployingUserId"
      :withdrawing-user-id="withdrawingUserId"
      @update:page="
        (next) => {
          page = next
          void load()
        }
      "
      @grants="grantUser = $event"
      @deploy="requestDeploy"
      @withdraw="requestWithdraw"
      @reset-password="openReset"
      @delete="deleteTarget = $event"
    />

    <p class="users-area__hint">
      通过专属注册链接注册的账户<strong>注册即授权</strong>（自动关联该链接对应的数字人）；
      其他数字人在「授权详情」里勾选后点<strong>「授权」</strong>并确认才会生效（授权 = 关联），
      点「退出」则放弃本次改动。授权只决定"允许使用什么"，点行内<strong>「部署」</strong>并确认后
      才会下发到运行环境；<strong>「停止」</strong>会撤回该账户的全部运行副本（授权与文件空间保留，
      用户立即无法使用，重新部署即可恢复）。
    </p>

    <UserEditor
      v-model:open="editorOpen"
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
      :open="deployTarget !== null"
      data-test="deploy-confirm"
      title="部署该账户？"
      :message="`确认把账户「${deployTarget?.display_name || deployTarget?.user_id || ''}」已授权的 ${deployTarget?.agents.length ?? 0} 个数字人下发到运行环境？部署是整体覆盖：取消授权的数字人副本会被移除，文件空间内容保留。`"
      confirm-label="确认部署"
      @update:open="
        (value) => {
          if (!value) deployTarget = null
        }
      "
      @confirm="confirmDeploy"
    />
    <ConfirmDialog
      :open="withdrawTarget !== null"
      data-test="withdraw-confirm"
      title="停止该账户？"
      :message="`确认停止账户「${withdrawTarget?.display_name || withdrawTarget?.user_id || ''}」？运行环境中的全部数字人副本将被撤回，该用户立即无法使用；授权（关联）与文件空间内容保留，重新部署即可恢复。`"
      confirm-label="确认停止"
      danger
      @update:open="
        (value) => {
          if (!value) withdrawTarget = null
        }
      "
      @confirm="confirmWithdraw"
    />
    <ConfirmDialog
      :open="deleteTarget !== null"
      title="删除账户"
      :message="`确认删除账户「${deleteTarget?.display_name || deleteTarget?.user_id || ''}」？删除后其注册信息与全部授权（关联）一并移除，运行环境中的数字人副本同时撤回；文件空间内容保留。`"
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
