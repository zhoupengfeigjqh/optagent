<script setup lang="ts">
/**
 * 用户管理表格：账户筛选后的当前页展示与行操作入口。
 *
 * 口径（2026-11-27 收敛后）：
 *  - **授权 = 关联**：`agents[]` 即"已授权的数字人"，没有独立的授权摘要；
 *  - **部署** 是把已授权数字人下发到运行环境的唯一入口，因此行内保留「部署」按钮，
 *    已授权为空时禁用（没有可下发的内容，且不应借此清空运行环境）；
 *  - 「修改」入口已删除：账户扩展字段只在新建时设置，数字人授权在「授权详情」里勾选。
 */
import { computed } from 'vue'
import type { AgentServiceItem, ErrorInfo, UserListItem } from '../../api/types'
import EmptyState from '../common/EmptyState.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  items: UserListItem[]
  services: AgentServiceItem[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  error: ErrorInfo | null
  /** 正在部署的账户（空 = 无部署进行中），用于禁用按钮并给出进行中文案 */
  deployingUserId?: string | null
  /** 正在停止（撤回部署）的账户（空 = 无停止进行中） */
  withdrawingUserId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'grants', user: UserListItem): void
  (e: 'deploy', user: UserListItem): void
  (e: 'withdraw', user: UserListItem): void
  (e: 'reset-password', user: UserListItem): void
  (e: 'delete', user: UserListItem): void
}>()

function isDeploying(user: UserListItem): boolean {
  return props.deployingUserId === user.user_id
}

function isWithdrawing(user: UserListItem): boolean {
  return props.withdrawingUserId === user.user_id
}

const serviceNames = computed(
  () => new Map(props.services.map((service) => [service.code, service.name])),
)
const totalPages = computed(() =>
  props.total <= 0 ? 0 : Math.ceil(props.total / Math.max(1, props.pageSize)),
)

function sourceLabel(user: UserListItem): string {
  if (!user.source_agent_code) return '—'
  const name = serviceNames.value.get(user.source_agent_code)
  return name ? `${name}（${user.source_agent_code}）` : user.source_agent_code
}
</script>

<template>
  <div class="account-table">
    <p v-if="loading" class="account-table__loading" role="status">账户加载中…</p>
    <ErrorNotice
      v-else-if="error"
      :error="error"
      title="账户加载失败"
    />
    <EmptyState
      v-else-if="items.length === 0"
      title="没有符合条件的账户"
      description="可以调整搜索条件，或新建一个账户。"
    />

    <template v-else>
      <div class="account-table__wrap">
        <table class="account-table__table">
          <caption class="visually-hidden">用户账户清单</caption>
          <thead>
            <tr>
              <th scope="col">手机号</th>
              <th scope="col">用户名</th>
              <th scope="col">注册来源服务</th>
              <th scope="col">已授权数字人</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in items" :key="user.user_id">
              <td>
                <span v-if="user.phone" class="mono">{{ user.phone }}</span>
                <span v-else class="account-table__muted">未绑定</span>
              </td>
              <td>
                <div class="account-table__name">
                  <span>{{ user.display_name || user.user_id }}</span>
                  <span
                    class="account-table__role"
                    :class="{ 'account-table__role--admin': user.role === 'admin' }"
                  >
                    {{ user.role === 'admin' ? '管理员' : '普通用户' }}
                  </span>
                </div>
                <div class="account-table__sub mono">{{ user.user_id }}</div>
              </td>
              <td>{{ sourceLabel(user) }}</td>
              <td>
                <span v-if="user.agents.length > 0" class="account-table__pill account-table__pill--ok">
                  已授权 {{ user.agents.length }}
                </span>
                <span v-else class="account-table__pill">未授权</span>
                <span
                  class="account-table__pill"
                  :class="{ 'account-table__pill--ok': user.deployed_at !== null }"
                >
                  {{ user.deployed_at === null ? '未部署' : '已部署' }}
                </span>
              </td>
              <td class="account-table__ops">
                <button type="button" class="btn btn--small" @click="emit('grants', user)">
                  授权详情
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--primary"
                  :disabled="isDeploying(user) || user.agents.length === 0"
                  :title="
                    user.agents.length === 0
                      ? '尚未授权任何数字人，没有可部署的内容'
                      : '把已授权的数字人下发到运行环境'
                  "
                  @click="emit('deploy', user)"
                >
                  {{ isDeploying(user) ? '部署中…' : '部署' }}
                </button>
                <!-- 停止 = 撤回部署（2026-11-27）：只下架运行环境副本，授权与文件空间保留 -->
                <button
                  type="button"
                  class="btn btn--small"
                  :disabled="isWithdrawing(user) || user.deployed_at === null"
                  :title="
                    user.deployed_at === null
                      ? '该账户尚未部署，无需停止'
                      : '撤回该账户在运行环境中的全部数字人副本，用户立即无法使用'
                  "
                  @click="emit('withdraw', user)"
                >
                  {{ isWithdrawing(user) ? '停止中…' : '停止' }}
                </button>
                <button
                  type="button"
                  class="btn btn--small"
                  @click="emit('reset-password', user)"
                >
                  重置密码
                </button>
                <button
                  type="button"
                  class="btn btn--small btn--danger"
                  @click="emit('delete', user)"
                >
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="totalPages > 1" class="account-table__pager" aria-label="账户分页">
        <button
          type="button"
          class="btn"
          :disabled="page <= 1"
          @click="emit('update:page', page - 1)"
        >
          上一页
        </button>
        <span>第 {{ page }} / {{ totalPages }} 页</span>
        <button
          type="button"
          class="btn"
          :disabled="page >= totalPages"
          @click="emit('update:page', page + 1)"
        >
          下一页
        </button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.account-table__loading {
  margin: 0;
  padding: var(--space-6);
  text-align: center;
  color: var(--color-text-muted);
}

.account-table__wrap {
  overflow-x: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.account-table__table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
}

.account-table__table th,
.account-table__table td {
  padding: 11px 14px;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  vertical-align: middle;
  font-size: var(--font-size-sm);
}

.account-table__table th {
  background: #fafbfc;
  color: var(--color-text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.account-table__table tbody tr:last-child td {
  border-bottom: none;
}

.account-table__table tbody tr:hover {
  background: #fafcff;
}

.account-table__name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 600;
}

.account-table__sub,
.account-table__muted {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.account-table__role,
.account-table__pill {
  display: inline-block;
  border-radius: var(--radius-sm);
  padding: 1px 7px;
  background: #f2f3f5;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
  white-space: nowrap;
}

.account-table__role--admin {
  color: var(--color-status-warning);
  background: var(--color-status-warning-bg);
}

.account-table__pill--ok {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
}

.account-table__pill + .account-table__pill {
  margin-left: var(--space-1);
}

.account-table__ops {
  white-space: nowrap;
}

.account-table__ops .btn {
  margin-right: 6px;
}

.account-table__ops .btn:last-child {
  margin-right: 0;
}

.account-table__pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

@media (max-width: 640px) {
  .account-table__table {
    min-width: 820px;
  }
}
</style>
