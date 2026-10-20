<script setup lang="ts">
/**
 * 数字人部署功能区（US2）。
 *
 * 承载：用户与关联数字人（**部署对象就在这些卡片上勾选**）、部署触发与结果、
 * 部署历史、**异常项汇总**（`FR-055`，作为本功能区内分区）。
 *
 * 勾选状态由**本组件**持有：勾选发生在下分区的用户卡片上，而"校验／部署"按钮在
 * 上分的部署面板里——跨分区的状态归共同父级（2026-09-16 十一次调整）。
 * 勾选**跨分页保留**（翻页继续勾会累加），因此不做"按当前页收敛"，
 * 只提供显式的「清空勾选」。
 */
import { onMounted, ref, watch } from 'vue'
import { DEPLOY_HISTORY_FETCH_LIMIT, fetchDeployHistory } from '../../api/deploy'
import { http } from '../../api/http'
import type { DeployHistoryItem, Paged, UserListItem } from '../../api/types'
import UserCardList from './UserCardList.vue'
import DeployPanel from './DeployPanel.vue'
import DeployHistoryList from './DeployHistoryList.vue'
import AnomalySummary from './AnomalySummary.vue'

const props = defineProps<{ detail: string | null; tab: string | null }>()
const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

const tab = ref(props.tab ?? 'users')

const page = ref(1)
const users = ref<Paged<UserListItem> | null>(null)
const usersError = ref<unknown>(null)
const usersLoading = ref(false)

/** 部署对象：勾选即"要部署给这个用户"（空 = 不允许校验/部署） */
const selectedUserIds = ref<string[]>([])

const history = ref<DeployHistoryItem[]>([])
/** 服务端有界返回（`FR-006`）：为真即"还有更早的记录没有拉取" */
const historyTruncated = ref(false)
/** 历史加载失败（2026-10-20）：失败 MUST 与"确实没有记录"区分开，否则空态会撒谎 */
const historyError = ref<unknown>(null)
const historyLoading = ref(false)

async function loadUsers(): Promise<void> {
  usersLoading.value = true
  usersError.value = null
  try {
    users.value = await http.get<Paged<UserListItem>>('/api/admin/users', {
      page: page.value,
      expand: 'summary',
    })
  } catch (err) {
    usersError.value = err
  } finally {
    usersLoading.value = false
  }
}

async function loadHistory(): Promise<void> {
  historyLoading.value = true
  historyError.value = null
  try {
    const res = await fetchDeployHistory(DEPLOY_HISTORY_FETCH_LIMIT)
    history.value = res.items
    historyTruncated.value = res.truncated
  } catch (err) {
    historyError.value = err
  } finally {
    historyLoading.value = false
  }
}

/** 勾选/取消一个用户（新数组 → 部署面板据此作废上一次预检） */
function toggleUser(userId: string, checked: boolean): void {
  const next = new Set(selectedUserIds.value)
  if (checked) next.add(userId)
  else next.delete(userId)
  selectedUserIds.value = [...next]
}

/**
 * 用户被删除后把它从勾选里摘掉（2026-10-20）。
 *
 * 勾选跨分页保留，所以不能"按当前页收敛"；但删除是**明确的单点失效**，
 * 不摘掉就会带着一个已不存在的用户去校验/部署 → 整批 404。
 */
function forgetUser(userId: string): void {
  if (!selectedUserIds.value.includes(userId)) return
  selectedUserIds.value = selectedUserIds.value.filter((id) => id !== userId)
}

function clearSelection(): void {
  selectedUserIds.value = []
  emit('announce', '已清空勾选的部署对象')
}

onMounted(() => {
  void loadUsers()
  void loadHistory()
})

watch(
  () => props.tab,
  (next) => {
    if (next) tab.value = next
  },
)
</script>

<template>
  <section class="deploy-area">
    <DeployPanel
      :selected-user-ids="selectedUserIds"
      @navigate="emit('navigate', $event)"
      @announce="emit('announce', $event)"
      @deployed="
        () => {
          void loadHistory()
          void loadUsers()
        }
      "
    />

    <nav class="deploy-area__tabs" aria-label="数字人部署功能区分区">
      <button
        type="button"
        class="btn"
        :class="{ 'btn--primary': tab === 'users' }"
        :aria-current="tab === 'users' ? 'true' : undefined"
        @click="tab = 'users'"
      >
        用户与关联
      </button>
      <button
        type="button"
        class="btn"
        :class="{ 'btn--primary': tab === 'anomalies' }"
        :aria-current="tab === 'anomalies' ? 'true' : undefined"
        @click="tab = 'anomalies'"
      >
        异常项汇总
      </button>
      <button
        type="button"
        class="btn"
        :class="{ 'btn--primary': tab === 'history' }"
        :aria-current="tab === 'history' ? 'true' : undefined"
        @click="tab = 'history'"
      >
        部署历史
      </button>
    </nav>

    <div class="deploy-area__panel">
      <UserCardList
        v-if="tab === 'users'"
        :items="users?.items ?? []"
        :total="users?.total ?? 0"
        :page="page"
        :loading="usersLoading"
        :error="usersError as never"
        :selected="selectedUserIds"
        @update:page="
          (next) => {
            page = next
            void loadUsers()
          }
        "
        @toggle="toggleUser"
        @clear="clearSelection"
        @removed="forgetUser"
        @changed="() => void loadUsers()"
        @announce="emit('announce', $event)"
      />
      <AnomalySummary v-else-if="tab === 'anomalies'" @navigate="emit('navigate', $event)" />
      <DeployHistoryList
        v-else
        :items="history"
        :truncated="historyTruncated"
        :error="historyError"
        :loading="historyLoading"
        @retry="loadHistory"
      />
    </div>
  </section>
</template>

<style scoped>
.deploy-area__tabs {
  display: flex;
  gap: var(--space-2);
  margin: var(--space-5) 0 var(--space-4);
}

.deploy-area__panel {
  display: block;
}
</style>
