<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AgentListItem, ErrorInfo, UserListItem } from '../../api/types'
import { listAgents } from '../../api/agents'
import { fetchManifest, withdrawDeploy } from '../../api/deploy'
import { createUser, deleteUser, resetUserPassword, updateUser } from '../../api/users'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import EntityCardList from '../common/EntityCardList.vue'
import ErrorNotice from '../common/ErrorNotice.vue'
import StatusBadge from '../common/StatusBadge.vue'
import ResetPasswordDialog from './ResetPasswordDialog.vue'
import UserEditor from './UserEditor.vue'

const props = defineProps<{
  items: UserListItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
  selected: string[]
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'toggle', userId: string, checked: boolean): void
  (e: 'clear'): void
  (e: 'removed', userId: string): void
  (e: 'changed'): void
  (e: 'announce', text: string): void
}>()

const editorOpen = ref(false)
const editing = ref<UserListItem | null>(null)
const busy = ref(false)
const localError = ref<ErrorInfo | null>(null)
const agents = ref<AgentListItem[]>([])
const pendingDelete = ref<UserListItem | null>(null)
const pendingWithdraw = ref<UserListItem | null>(null)
const withdrawing = ref(false)
const pendingReset = ref<UserListItem | null>(null)
const resetting = ref(false)
const resetError = ref<ErrorInfo | null>(null)

const showError = computed(() => props.error)

function deployLabel(user: UserListItem): string {
  return user.deployed_at ? `已部署 ${formatDeployedAt(user.deployed_at)}` : '未部署'
}

function formatDeployedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function onToggle(userId: string, event: Event): void {
  emit('toggle', userId, (event.target as HTMLInputElement).checked)
}

async function ensureAgents(): Promise<void> {
  try {
    agents.value = (await listAgents(1)).items
  } catch (err) {
    localError.value = err as ErrorInfo
  }
}

async function openCreate(): Promise<void> {
  await ensureAgents()
  editing.value = null
  editorOpen.value = true
}

async function openEdit(user: UserListItem): Promise<void> {
  await ensureAgents()
  editing.value = user
  editorOpen.value = true
}

async function submit(payload: {
  user_id: string
  agents: string[]
  password?: string
  phone?: string
  display_name?: string
  role?: 'admin' | 'user'
}): Promise<void> {
  busy.value = true
  localError.value = null
  try {
    if (editing.value) {
      const { revision } = await fetchManifest()
      await updateUser(editing.value.user_id, payload.agents, revision)
      emit('announce', `用户 ${editing.value.user_id} 的关联已更新`)
    } else {
      await createUser(payload.user_id, payload.agents, payload.password, {
        ...(payload.phone ? { phone: payload.phone } : {}),
        ...(payload.display_name ? { display_name: payload.display_name } : {}),
        ...(payload.role ? { role: payload.role } : {}),
      })
      emit('announce', `用户 ${payload.user_id} 已创建`)
    }
    editorOpen.value = false
    emit('changed')
  } catch (err) {
    localError.value = err as ErrorInfo
  } finally {
    busy.value = false
  }
}

async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value
  if (!target) return
  localError.value = null
  try {
    await deleteUser(target.user_id)
    emit(
      'announce',
      `用户 ${target.user_id} 已从平台删除：数字人已撤回（随即失去能力），文件空间内容保留`,
    )
    emit('removed', target.user_id)
    emit('changed')
  } catch (err) {
    localError.value = err as ErrorInfo
  } finally {
    pendingDelete.value = null
  }
}

/**
 * 撤回该用户的部署：清空**运行环境**里的数字人目录（这些数字人随即失去能力）。
 *
 * 平台侧关联与用户文件空间保留，需要时重新部署即可恢复。
 * 乐观锁用当前的全局 `revision`（与「编辑关联」同一口径，避免基于陈旧配置写入）。
 */
async function confirmWithdraw(): Promise<void> {
  const target = pendingWithdraw.value
  if (!target || withdrawing.value) return
  withdrawing.value = true
  localError.value = null
  try {
    const { revision } = await fetchManifest()
    const result = await withdrawDeploy(target.user_id, revision)
    emit(
      'announce',
      `已撤回用户 ${target.user_id} 的部署：下架 ${result.withdrawn.length} 个数字人（文件空间未动，重新部署即可恢复）`,
    )
    emit('changed')
  } catch (err) {
    localError.value = err as ErrorInfo
  } finally {
    withdrawing.value = false
    pendingWithdraw.value = null
  }
}

function openReset(user: UserListItem): void {
  resetError.value = null
  pendingReset.value = user
}

async function submitReset(password: string): Promise<void> {
  const target = pendingReset.value
  if (!target || resetting.value) return
  resetting.value = true
  resetError.value = null
  try {
    await resetUserPassword(target.user_id, password)
    emit('announce', `用户 ${target.user_id} 的密码已重置，其原有登录会话已失效`)
    pendingReset.value = null
  } catch (err) {
    resetError.value = err as ErrorInfo
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="user-card-list">
    <div class="user-card-list__toolbar">
      <template v-if="props.selected.length > 0">
        <span class="user-card-list__picked" role="status">
          已勾选 {{ props.selected.length }} 个部署对象
        </span>
        <button type="button" class="btn" @click="emit('clear')">清空勾选</button>
      </template>
      <button type="button" class="btn btn--primary" @click="openCreate">新建用户</button>
    </div>

    <ErrorNotice v-if="localError" :error="localError" title="操作未完成" />

    <EntityCardList
      title="用户与关联数字人"
      :items="items"
      :total="total"
      :page="page"
      :loading="loading"
      :error="showError"
      :item-key="(item) => (item as UserListItem).user_id"
      empty-title="还没有用户"
      empty-description="点击「新建用户」把数字人分配给业务使用者。"
      @update:page="emit('update:page', $event)"
    >
      <template #item="{ item }">
        <article class="card" :aria-label="`用户 ${(item as UserListItem).user_id}`">
          <p class="card__head">
            <span class="card__title">{{ (item as UserListItem).user_id }}</span>
            <span class="user-card-list__status">
              <StatusBadge
                :status="(item as UserListItem).deployed_at ? 'deployed' : 'not_deployed'"
                :label="deployLabel(item as UserListItem)"
                :tone="(item as UserListItem).deployed_at ? 'success' : 'neutral'"
              />
            </span>
            <label class="user-card-list__pick">
              <input
                type="checkbox"
                :checked="props.selected.includes((item as UserListItem).user_id)"
                :aria-label="`把用户 ${(item as UserListItem).user_id} 作为本次部署对象`"
                @change="onToggle((item as UserListItem).user_id, $event)"
              />
              部署对象
            </label>
          </p>

          <p class="user-card-list__account">
            <StatusBadge
              :status="(item as UserListItem).role === 'admin' ? 'admin' : 'user'"
              :label="(item as UserListItem).role === 'admin' ? '管理员' : '普通用户'"
              :tone="(item as UserListItem).role === 'admin' ? 'warning' : 'neutral'"
            />
            <template v-if="(item as UserListItem).phone">
              <span class="mono">{{ (item as UserListItem).phone }}</span>
            </template>
            <template v-if="(item as UserListItem).display_name">
              {{ (item as UserListItem).display_name }}
            </template>
            <span
              v-if="((item as UserListItem).grants_summary?.approved ?? 0) > 0"
              class="user-card-list__grants"
            >
              已授权 {{ (item as UserListItem).grants_summary?.approved ?? 0 }} 个数字人服务<template
                v-if="((item as UserListItem).grants_summary?.pending ?? 0) > 0"
                >，待审批 {{ (item as UserListItem).grants_summary?.pending ?? 0 }}</template
              >
            </span>
          </p>
          <p v-if="(item as UserListItem).agents.length === 0" class="card__meta">
            未关联任何数字人
          </p>
          <details v-else class="user-card-list__details">
            <summary>
              已关联 {{ (item as UserListItem).agents.length }} 个数字人
              <StatusBadge
                v-if="(item as UserListItem).agents.some((a) => a.abnormal)"
                status="abnormal"
                label="含异常"
                tone="error"
              />
            </summary>
            <ul class="user-card-list__agents">
              <li v-for="agent in (item as UserListItem).agents" :key="agent.name">
                <span class="mono">{{ agent.name }}</span>
                <StatusBadge
                  v-if="agent.abnormal"
                  status="abnormal"
                  :label="agent.abnormal_reason ?? '异常'"
                  tone="error"
                />
              </li>
            </ul>
            <ul
              v-if="(item as UserListItem).summary"
              class="user-card-list__summary"
              aria-label="搭配摘要"
            >
              <li v-for="entry in (item as UserListItem).summary ?? []" :key="entry.name">
                <span class="mono">{{ entry.name }}</span
                >： MCP {{ entry.mcp_services.join('、') || '无' }}； 工具
                {{ entry.enabled_tools.join('、') || '无' }}； SKILL
                {{ entry.skills.join('、') || '无' }}
              </li>
            </ul>
          </details>

          <div class="card__actions">
            <button
              v-if="(item as UserListItem).deployed_at"
              type="button"
              class="btn"
              :disabled="withdrawing"
              @click="pendingWithdraw = item as UserListItem"
            >
              撤回
            </button>
            <button type="button" class="btn" @click="openReset(item as UserListItem)">
              重置密码
            </button>
            <button type="button" class="btn" @click="openEdit(item as UserListItem)">
              编辑关联
            </button>
            <button type="button" class="btn" @click="pendingDelete = item as UserListItem">
              删除
            </button>
          </div>
        </article>
      </template>
    </EntityCardList>

    <UserEditor
      v-model:open="editorOpen"
      :user="editing"
      :agents="agents"
      :busy="busy"
      @submit="submit"
    />

    <ResetPasswordDialog
      data-test="reset-password-dialog"
      :open="pendingReset !== null"
      :user-id="pendingReset?.user_id ?? ''"
      :busy="resetting"
      :error="resetError"
      @update:open="
        (value) => {
          if (!value) pendingReset = null
        }
      "
      @submit="submitReset"
    />

    <ConfirmDialog
      :open="pendingDelete !== null"
      data-test="delete-dialog"
      title="删除该用户？"
      message="删除平台侧用户记录，并撤回该用户在运行环境中的数字人（这些数字人随即失去能力）；用户文件空间的内容一律保留。"
      confirm-label="删除"
      danger
      @update:open="
        (value) => {
          if (!value) pendingDelete = null
        }
      "
      @confirm="confirmDelete"
    />

    <ConfirmDialog
      :open="pendingWithdraw !== null"
      data-test="withdraw-dialog"
      title="撤回该用户的部署？"
      :message="`将清空用户「${pendingWithdraw?.user_id ?? ''}」在运行环境中的数字人目录，这些数字人随即失去能力；平台侧的关联与该用户的文件空间一律保留，需要时重新部署即可恢复。`"
      confirm-label="撤回"
      danger
      @update:open="
        (value) => {
          if (!value) pendingWithdraw = null
        }
      "
      @confirm="confirmWithdraw"
    />
  </div>
</template>

<style scoped>
.user-card-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-bottom: var(--space-4);
}

.user-card-list__picked {
  margin-right: auto;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.card__head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
}

.user-card-list__status {
  margin-right: auto;
}

.user-card-list__pick {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  cursor: pointer;
}

.user-card-list__details summary {
  cursor: pointer;
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
}

.user-card-list__agents,
.user-card-list__summary {
  margin: var(--space-2) 0 0;
  padding-left: var(--space-4);
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.user-card-list__agents li {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  flex-wrap: wrap;
}

.user-card-list__account {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-2) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.user-card-list__grants {
  color: var(--color-text-muted);
}
</style>
