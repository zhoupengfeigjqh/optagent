<script setup lang="ts">
/**
 * 「停止注册」弹窗（2026-11-27）：列出该服务编码下**全部**注册链接及其状态，
 * 支持逐条关闭或一次性全部关闭；每次关闭都必须二次确认。
 *
 * 语义边界：
 * - 关闭 = 软撤销（写 `revoked_at`），记录保留可追溯，链接立即无法再用于注册；
 * - 只影响"新用户注册"，**已注册用户的使用权不变**（授权与部署是两回事）。
 */
import { computed, ref, watch } from 'vue'
import { listRegisterLinks, revokeRegisterLink } from '../../api/account'
import type { ErrorInfo, RegisterLinkItem } from '../../api/types'
import { isExpired, formatDateTime } from '../../utils/datetime'
import BaseDialog from '../common/BaseDialog.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
  agentName: string
  /** 为空 = 该数字人没有服务编码，无法管理链接 */
  serviceCode: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'announce', text: string): void
}>()

type LinkState = 'active' | 'expired' | 'revoked'

interface LinkRow {
  link: RegisterLinkItem
  state: LinkState
  stateLabel: string
}

const links = ref<RegisterLinkItem[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref<ErrorInfo | null>(null)
/** 待确认的关闭动作：单条（token）或全部 */
const pending = ref<{ kind: 'one'; token: string } | { kind: 'all' } | null>(null)

function stateOf(link: RegisterLinkItem): LinkState {
  if (link.revoked_at) return 'revoked'
  if (isExpired(link.expires_at)) return 'expired'
  return 'active'
}

const STATE_LABELS: Record<LinkState, string> = {
  active: '有效',
  expired: '已过期',
  revoked: '已撤销',
}

/** 有效的排在前面，同状态按创建时间倒序（最近生成的先看到） */
const rows = computed<LinkRow[]>(() => {
  const order: Record<LinkState, number> = { active: 0, expired: 1, revoked: 2 }
  return links.value
    .map((link) => {
      const state = stateOf(link)
      return { link, state, stateLabel: STATE_LABELS[state] }
    })
    .sort(
      (a, b) => order[a.state] - order[b.state] || b.link.created_at.localeCompare(a.link.created_at),
    )
})

const activeCount = computed(() => links.value.filter((link) => stateOf(link) === 'active').length)

async function load(): Promise<void> {
  if (!props.serviceCode) {
    links.value = []
    return
  }
  loading.value = true
  error.value = null
  try {
    links.value = (await listRegisterLinks(props.serviceCode)).items
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

/** 单条关闭：先弹二次确认 */
function requestRevoke(link: RegisterLinkItem): void {
  if (stateOf(link) !== 'active' || busy.value) return
  pending.value = { kind: 'one', token: link.token }
}

/** 全部关闭：只针对仍有效的链接，先弹二次确认 */
function requestRevokeAll(): void {
  if (activeCount.value === 0 || busy.value) return
  pending.value = { kind: 'all' }
}

const confirmMessage = computed(() => {
  if (pending.value?.kind === 'one') {
    return '关闭该条注册链接？关闭后立即无法再用于注册（记录保留，可追溯），已注册用户不受影响。'
  }
  return `将关闭该数字人「${props.agentName}」的 ${activeCount.value} 条有效注册链接，关闭后这些链接立即失效（记录保留，可追溯）；已注册用户不受影响。`
})

async function confirmRevoke(): Promise<void> {
  const target = pending.value
  pending.value = null
  if (!target || busy.value) return
  busy.value = true
  error.value = null
  let closed = 0
  try {
    if (target.kind === 'one') {
      await revokeRegisterLink(target.token)
      closed = 1
    } else {
      // 串行撤销：条数很少，避免并发写同一份链接清单
      for (const link of links.value.filter((item) => stateOf(item) === 'active')) {
        await revokeRegisterLink(link.token)
        closed += 1
      }
    }
    emit('announce', `已关闭 ${closed} 条注册链接，立即失效`)
    await load()
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    busy.value = false
  }
}

watch(
  () => [props.open, props.serviceCode] as const,
  ([open], previous) => {
    const opened = open && (previous === undefined || previous[0] !== true)
    if (!opened) return
    pending.value = null
    error.value = null
    void load()
  },
  { immediate: true },
)
</script>

<template>
  <BaseDialog
    :open="open"
    title="停止注册"
    :width="720"
    show-close
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <p class="register-links__intro">
        数字人「<strong>{{ agentName }}</strong>」的注册链接（共 {{ links.length }} 条，其中
        <strong>{{ activeCount }}</strong> 条有效）。关闭后链接立即失效，记录保留可追溯；
        <strong>已注册用户不受影响</strong>。
      </p>

      <ErrorNotice v-if="error" :error="error" title="注册链接操作未完成" />

      <p v-if="!serviceCode" class="register-links__empty">该数字人尚未配置注册服务，无法管理链接。</p>
      <p v-else-if="loading" class="register-links__empty" role="status">链接清单加载中…</p>
      <p v-else-if="rows.length === 0" class="register-links__empty">
        该数字人还没有生成过注册链接。
      </p>
      <div v-else class="register-links__table-wrap">
        <table class="register-links__table">
          <thead>
            <tr>
              <th scope="col">链接标识</th>
              <th scope="col">创建时间</th>
              <th scope="col">有效期至</th>
              <th scope="col">已用</th>
              <th scope="col">状态</th>
              <th scope="col"><span class="visually-hidden">操作</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in rows" :key="row.link.token">
              <td class="mono" :title="row.link.token">{{ row.link.token.slice(0, 10) }}…</td>
              <td>{{ formatDateTime(row.link.created_at) }}</td>
              <td>{{ row.link.expires_at ? formatDateTime(row.link.expires_at) : '长期有效' }}</td>
              <td>{{ row.link.use_count }} 次</td>
              <td>
                <span class="register-links__state" :data-state="row.state">
                  {{ row.stateLabel }}
                </span>
              </td>
              <td class="register-links__actions">
                <button
                  type="button"
                  class="btn btn--small"
                  :disabled="row.state !== 'active' || busy"
                  @click="requestRevoke(row.link)"
                >
                  关闭
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template #footer>
      <button type="button" class="btn" @click="emit('update:open', false)">关闭</button>
      <button
        type="button"
        class="btn btn--danger"
        :disabled="activeCount === 0 || busy"
        :title="activeCount === 0 ? '没有有效链接可关闭' : `一次性关闭 ${activeCount} 条有效链接`"
        @click="requestRevokeAll"
      >
        {{ busy ? '处理中…' : '全部关闭' }}
      </button>
    </template>
  </BaseDialog>

  <ConfirmDialog
    :open="pending !== null"
    data-test="revoke-links-confirm"
    title="停止注册并关闭链接？"
    :message="confirmMessage"
    confirm-label="确认关闭"
    danger
    @update:open="
      (value) => {
        if (!value) pending = null
      }
    "
    @confirm="confirmRevoke"
  />
</template>

<style scoped>
.register-links__intro {
  margin: 0 0 var(--space-3);
  padding: var(--space-3);
  border: 1px solid #d8e5fd;
  border-radius: var(--radius-md);
  background: var(--color-primary-subtle);
  color: #33507e;
  font-size: var(--font-size-xs);
  line-height: 1.7;
}

.register-links__empty {
  margin: 0;
  padding: var(--space-5) 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.register-links__table-wrap {
  max-height: 320px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.register-links__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--font-size-sm);
}

.register-links__table th,
.register-links__table td {
  padding: var(--space-2) var(--space-3);
  text-align: left;
  white-space: nowrap;
}

.register-links__table thead th {
  position: sticky;
  top: 0;
  background: var(--color-bg-subtle);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.register-links__table tbody tr + tr {
  border-top: 1px solid var(--color-border);
}

.register-links__state {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
}

.register-links__state[data-state='active'] {
  background: var(--color-status-success-bg);
  color: var(--color-status-success);
}

.register-links__state[data-state='expired'] {
  background: var(--color-status-warning-bg);
  color: var(--color-status-warning);
}

.register-links__state[data-state='revoked'] {
  background: var(--color-status-pending-bg);
  color: var(--color-text-muted);
}

.register-links__actions {
  text-align: right;
}
</style>
