<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { http } from '../../api/http'
import type {
  McpServiceDetail,
  McpServiceListItem,
  McpStatsItem,
  McpToolInfo,
  Paged,
} from '../../api/types'
import { buildPath } from '../../router'
import McpCardList from './McpCardList.vue'
import McpCreateDialog from './McpCreateDialog.vue'
import McpServiceDetailView from './McpServiceDetail.vue'
import McpToolScopeDialog from './McpToolScopeDialog.vue'

const props = defineProps<{ detail: string | null; tab: string | null }>()
const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

const page = ref(1)
const list = ref<Paged<McpServiceListItem> | null>(null)
const error = ref<unknown>(null)
const loading = ref(false)
const openedName = ref<string | null>(null)
const detailLoading = ref(false)
const serviceDetail = ref<McpServiceDetail | null>(null)
const stats = ref<McpStatsItem[]>([])
const statsAvailable = ref(true)

const createOpen = ref(false)
const scopeOpen = ref(false)
/**
 * 「刚创建、待自动测试一次」的服务名。
 *
 * 用**一次性意图**而非持久 prop：测完（或离开详情）即清，避免"再次打开该服务又自动测一遍"。
 */
const pendingAutoTest = ref<string | null>(null)
const detailRef = ref<InstanceType<typeof McpServiceDetailView> | null>(null)

async function loadList(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    list.value = await http.get<Paged<McpServiceListItem>>('/api/admin/mcp/services', {
      page: page.value,
    })
  } catch (err) {
    error.value = err
  } finally {
    loading.value = false
  }
}

async function loadStats(): Promise<void> {
  try {
    const res = await http.get<{ stats_available: boolean; items: McpStatsItem[] }>(
      '/api/admin/mcp/stats',
    )
    statsAvailable.value = res.stats_available
    stats.value = res.items
  } catch {
    // 统计读不到即"未知"，MUST NOT 以 0 冒充（FR-009）
    statsAvailable.value = false
    stats.value = []
  }
}

async function loadDetail(name: string): Promise<void> {
  error.value = null
  detailLoading.value = true
  try {
    serviceDetail.value = await http.get<McpServiceDetail>(
      `/api/admin/mcp/services/${encodeURIComponent(name)}`,
    )
  } catch (err) {
    serviceDetail.value = null
    error.value = err
  } finally {
    detailLoading.value = false
  }
}

async function syncFromRoute(name: string | null): Promise<void> {
  openedName.value = name
  scopeOpen.value = false

  if (!name) {
    serviceDetail.value = null
    detailLoading.value = false
    // 离开详情即放弃"待自动测试"的意图（否则下次打开它会莫名自动测一次）
    pendingAutoTest.value = null
    void loadList()
    void loadStats()
    return
  }

  // 切换服务时清掉上一份数据，否则会短暂显示"上一个服务"的内容
  serviceDetail.value = null
  await loadDetail(name)
  if (pendingAutoTest.value !== name) return
  pendingAutoTest.value = null
  if (!serviceDetail.value) return
  await nextTick()
  emit('announce', '服务已创建，正在自动测试连接…')
  void detailRef.value?.runTest()
}

function reloadDetail(): void {
  if (openedName.value) void loadDetail(openedName.value)
}

/**
 * 「重新探测」（2026-10-15 起不止是刷新）：重取详情（后端现连服务）→
 * **探测成功即打开工具范围弹窗**，让管理员顺手增减可见工具。
 *
 * 探测失败（`tools_error` 非空）时**不开窗**：那时拿不到可信的全量清单，
 * 勾选等于凭空造范围；详情页此刻已如实展示"清单不可得 + 原因"，这里只补一句播报。
 */
async function onReprobe(): Promise<void> {
  const name = openedName.value
  if (!name) return
  await loadDetail(name)
  const detail = serviceDetail.value
  if (detail === null) return
  if (detail.tools_error) {
    emit('announce', '工具清单不可得，本次无法调整工具范围；请先确认服务可达')
    return
  }
  scopeOpen.value = true
}

function onScopeSaved(result: { allowed_tools: string[]; revision: number }): void {
  scopeOpen.value = false
  const detail = serviceDetail.value
  if (detail) {
    detail.allowed_tools = result.allowed_tools
    detail.revision = result.revision
    detail.tools = result.allowed_tools
      .map((toolName) => detail.available_tools.find((tool) => tool.name === toolName))
      .filter((tool): tool is McpToolInfo => tool !== undefined)
    detail.missing_tools = result.allowed_tools.filter(
      (toolName) => !detail.available_tools.some((tool) => tool.name === toolName),
    )
    // 勾选只可能来自 `available_tools`（本身有界），投影后必然不超上限
    detail.tools_truncated = false
  }
  void loadList()
}

function onCreated(name: string): void {
  createOpen.value = false
  pendingAutoTest.value = name
  emit('navigate', buildPath({ name: 'mcp', detail: name }))
}

/**
 * 详情内的变更回调（契约 §0.5 保存交互）。
 *
 * - **带 `revision`**（保存调用配置）→ 只**原地更新**该字段，MUST NOT 重载详情：
 *   重载会换掉 `props.service` 对象，从而触发详情页整表重填（丢掉未提交的编辑），
 *   并多打一次 MCP 实时探测（工具清单抖动 → 复选框清单与手填框来回切换 = "闪"）。
 */
function onDetailChanged(revision?: number): void {
  void loadList()
  if (!serviceDetail.value) return
  if (revision === undefined) {
    void loadDetail(serviceDetail.value.name)
    return
  }
  serviceDetail.value.revision = revision
}

function backToList(): void {
  openedName.value = null
  serviceDetail.value = null
  emit('navigate', buildPath({ name: 'mcp' }))
}

onMounted(() => {
  void syncFromRoute(props.detail)
})

watch(
  () => props.detail,
  (name) => void syncFromRoute(name),
)
</script>

<template>
  <section class="mcp-area">
    <McpServiceDetailView
      v-if="openedName"
      ref="detailRef"
      :opened-name="openedName"
      :service="serviceDetail"
      :loading="detailLoading"
      :error="error as never"
      @back="backToList"
      @deleted="backToList"
      @reload="reloadDetail"
      @reprobe="onReprobe"
      @changed="onDetailChanged"
      @announce="emit('announce', $event)"
    />

    <McpToolScopeDialog
      v-if="openedName && serviceDetail"
      v-model:open="scopeOpen"
      :service="serviceDetail"
      @saved="onScopeSaved"
      @announce="emit('announce', $event)"
    />
    <template v-else>
      <McpCardList
        :items="list?.items ?? []"
        :total="list?.total ?? 0"
        :page="page"
        :loading="loading"
        :error="error as never"
        :stats="stats"
        :stats-available="statsAvailable"
        @update:page="
          (next) => {
            page = next
            void loadList()
          }
        "
        @open="(name) => emit('navigate', buildPath({ name: 'mcp', detail: name }))"
        @create="createOpen = true"
      />

      <McpCreateDialog
        v-model:open="createOpen"
        @created="onCreated"
        @announce="emit('announce', $event)"
      />
    </template>
  </section>
</template>
