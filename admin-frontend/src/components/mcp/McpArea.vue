<script setup lang="ts">
/**
 * MCP 服务功能区：卡片列表 ↔ 服务详情/新建（调用配置、工具清单、调用统计）。
 *
 * **2026-09-27**：MCP 服务由管理员在平台内**全人工登记**（新建/编辑/删除），
 * 不再从容器编排声明派生；启停与运行日志已下架。
 *
 * 新建沿用数字人设计的范式：同一功能区内的**路径哨兵**
 * （`NEW_MCP_SENTINEL`），保持功能区内导航不超过两级（`FR-053`）。
 */
import { onMounted, ref, watch } from 'vue'
import { http } from '../../api/http'
import type { McpServiceDetail, McpServiceListItem, McpStatsItem, Paged } from '../../api/types'
import { buildPath } from '../../router'
import { NEW_MCP_SENTINEL } from '../../constants/mcp'
import McpCardList from './McpCardList.vue'
import McpServiceDetailView from './McpServiceDetail.vue'

const props = defineProps<{ detail: string | null; tab: string | null }>()
const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

const page = ref(1)
const list = ref<Paged<McpServiceListItem> | null>(null)
const error = ref<unknown>(null)
const loading = ref(false)
/** 当前打开的服务详情（与 props.detail 同名会与路由参数混淆，故显式改名） */
const serviceDetail = ref<McpServiceDetail | null>(null)
const stats = ref<McpStatsItem[]>([])
const statsAvailable = ref(true)

/** 新建态：详情路径为哨兵 */
const isNew = ref(false)

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
  try {
    serviceDetail.value = await http.get<McpServiceDetail>(
      `/api/admin/mcp/services/${encodeURIComponent(name)}`,
    )
  } catch (err) {
    error.value = err
  }
}

/** 路由 detail 变化 → 切换列表 / 新建 / 详情 */
function syncFromRoute(name: string | null): void {
  if (name === NEW_MCP_SENTINEL) {
    isNew.value = true
    serviceDetail.value = null
    return
  }
  isNew.value = false
  if (name) {
    void loadDetail(name)
  } else {
    serviceDetail.value = null
    void loadList()
    void loadStats()
  }
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

onMounted(() => {
  syncFromRoute(props.detail)
})

watch(
  () => props.detail,
  (name) => syncFromRoute(name),
)
</script>

<template>
  <section class="mcp-area">
    <McpServiceDetailView
      v-if="isNew || serviceDetail"
      :service="serviceDetail"
      :is-new="isNew"
      :error="(error as never)"
      @back="
        () => {
          serviceDetail = null
          isNew = false
          emit('navigate', buildPath({ name: 'mcp' }))
        }
      "
      @created="(name) => emit('navigate', buildPath({ name: 'mcp', detail: name }))"
      @deleted="
        () => {
          serviceDetail = null
          emit('navigate', buildPath({ name: 'mcp' }))
        }
      "
      @changed="onDetailChanged"
      @announce="emit('announce', $event)"
    />
    <template v-else>
      <McpCardList
        :items="list?.items ?? []"
        :total="list?.total ?? 0"
        :page="page"
        :loading="loading"
        :error="(error as never)"
        :stats="stats"
        :stats-available="statsAvailable"
        @update:page="
          (next) => {
            page = next
            void loadList()
          }
        "
        @open="(name) => emit('navigate', buildPath({ name: 'mcp', detail: name }))"
        @create="emit('navigate', buildPath({ name: 'mcp', detail: NEW_MCP_SENTINEL }))"
      />
    </template>
  </section>
</template>
