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
  const res = await fetchDeployHistory(DEPLOY_HISTORY_FETCH_LIMIT)
  history.value = res.items
  historyTruncated.value = res.truncated
}

/** 勾选/取消一个用户（新数组 → 部署面板据此作废上一次预检） */
function toggleUser(userId: string, checked: boolean): void {
  const next = new Set(selectedUserIds.value)
  if (checked) next.add(userId)
  else next.delete(userId)
  selectedUserIds.value = [...next]
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
        :error="(usersError as never)"
        :selected="selectedUserIds"
        @update:page="
          (next) => {
            page = next
            void loadUsers()
          }
        "
        @toggle="toggleUser"
        @clear="clearSelection"
        @changed="() => void loadUsers()"
        @announce="emit('announce', $event)"
      />
      <AnomalySummary v-else-if="tab === 'anomalies'" @navigate="emit('navigate', $event)" />
      <DeployHistoryList v-else :items="history" :truncated="historyTruncated" />
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
