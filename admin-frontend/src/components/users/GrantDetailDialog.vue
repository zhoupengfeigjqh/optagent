<script setup lang="ts">
/**
 * 账户授权详情：按账户手机号拉取全部授权记录，并支持审批通过、关闭和重新授权。
 */
import { ref, watch } from 'vue'
import { approveGrant, listGrants, revokeGrant } from '../../api/account'
import type { ErrorInfo, GrantItem, UserListItem } from '../../api/types'
import BaseDialog from '../common/BaseDialog.vue'
import ErrorNotice from '../common/ErrorNotice.vue'

const props = defineProps<{
  open: boolean
  user: UserListItem | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'changed'): void
  (e: 'announce', text: string): void
}>()

const items = ref<GrantItem[]>([])
const loading = ref(false)
const error = ref<ErrorInfo | null>(null)
const busyKey = ref('')
const noPhone = ref(false)

/** 授权列表后端按 8 条分页；详情需要完整记录，因此逐页取完。 */
async function loadAll(): Promise<void> {
  const phone = props.user?.phone ?? ''
  items.value = []
  error.value = null
  noPhone.value = phone === ''
  if (noPhone.value) return

  loading.value = true
  try {
    const first = await listGrants({ phone, page: 1 })
    const rest = await Promise.all(
      Array.from({ length: Math.max(0, first.total_pages - 1) }, (_, index) =>
        listGrants({ phone, page: index + 2 }),
      ),
    )
    items.value = [first, ...rest].flatMap((page) => page.items)
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

async function updateGrant(item: GrantItem, action: 'approve' | 'revoke'): Promise<void> {
  if (!props.user) return
  busyKey.value = `${item.user_id}:${item.agent_code}`
  error.value = null
  try {
    if (action === 'approve') await approveGrant(item.user_id, item.agent_code)
    else await revokeGrant(item.user_id, item.agent_code)
    emit('announce', action === 'approve' ? '授权已通过' : '授权已关闭')
    emit('changed')
    await loadAll()
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    busyKey.value = ''
  }
}

function statusText(item: GrantItem): string {
  if (item.status === 'approved') return '已授权'
  if (item.status === 'pending') return '待审批'
  return '已关闭'
}

watch(
  () => [props.open, props.user?.user_id] as const,
  ([open], previous) => {
    const opened = open && (previous === undefined || previous[0] !== true)
    if (opened) void loadAll()
  },
  { immediate: true },
)
</script>

<template>
  <BaseDialog
    :open="open"
    title="授权详情"
    :width="640"
    @update:open="emit('update:open', $event)"
  >
    <template v-if="open">
      <div class="grant-detail__summary">
        <span>账户</span>
        <strong>{{ user?.display_name || user?.user_id || '—' }}</strong>
        <span class="mono">{{ user?.phone || '未绑定手机号' }}</span>
      </div>

      <p class="grant-detail__label">全部授权申请与状态</p>
      <ErrorNotice v-if="error" :error="error" title="授权详情加载失败" />
      <p v-else-if="noPhone" class="grant-detail__empty">
        该账户未绑定手机号，暂时无法关联查询授权记录。
      </p>
      <p v-else-if="loading" class="grant-detail__empty" role="status">授权记录加载中…</p>
      <p v-else-if="items.length === 0" class="grant-detail__empty">
        暂无授权记录。通过专属注册链接注册的账户会自动出现在这里。
      </p>
      <div v-else class="grant-detail__list">
        <article v-for="item in items" :key="`${item.user_id}:${item.agent_code}`">
          <div class="grant-detail__info">
            <p class="grant-detail__name">{{ item.agent_name }}</p>
            <p class="grant-detail__sub mono">{{ item.agent_code }} · {{ item.created_at }}</p>
          </div>
          <span
            class="grant-detail__status"
            :class="`grant-detail__status--${item.status}`"
          >
            {{ statusText(item) }}
          </span>
          <div class="grant-detail__actions">
            <button
              v-if="item.status !== 'approved'"
              type="button"
              class="btn btn--small btn--primary"
              :disabled="busyKey !== ''"
              @click="updateGrant(item, 'approve')"
            >
              {{ item.status === 'revoked' ? '重新授权' : '通过授权' }}
            </button>
            <button
              v-if="item.status !== 'revoked'"
              type="button"
              class="btn btn--small"
              :disabled="busyKey !== ''"
              @click="updateGrant(item, 'revoke')"
            >
              关闭授权
            </button>
          </div>
        </article>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.grant-detail__summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.grant-detail__summary strong {
  color: var(--color-text);
}

.grant-detail__label {
  margin: var(--space-4) 0 var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.grant-detail__empty {
  margin: 0;
  padding: var(--space-5) 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.grant-detail__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  max-height: 52vh;
  overflow-y: auto;
}

.grant-detail__list article {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  flex-wrap: wrap;
}

.grant-detail__info {
  flex: 1;
  min-width: 180px;
}

.grant-detail__name,
.grant-detail__sub {
  margin: 0;
}

.grant-detail__name {
  font-weight: 600;
}

.grant-detail__sub {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.grant-detail__status {
  border-radius: var(--radius-sm);
  padding: 1px 7px;
  background: #f2f3f5;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.grant-detail__status--approved {
  color: var(--color-status-success);
  background: var(--color-status-success-bg);
}

.grant-detail__status--pending {
  color: var(--color-status-warning);
  background: var(--color-status-warning-bg);
}

.grant-detail__actions {
  display: flex;
  gap: var(--space-2);
}
</style>
