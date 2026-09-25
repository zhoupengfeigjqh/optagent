<script setup lang="ts">
/**
 * MCP 服务功能区（US4）：卡片列表 → 服务详情（服务启停、调用配置、
 * 工具清单、运行日志、调用统计、编排声明）。
 */
import { onMounted, ref, watch } from 'vue'
import { http } from '../../api/http'
import type { McpServiceDetail, McpServiceListItem, McpStatsItem, Paged } from '../../api/types'
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

/**
 * 详情内的变更回调（契约 §0.5 保存交互）。
 *
 * - **带 `revision`**（保存调用配置）→ 只**原地更新**该字段，MUST NOT 重载详情：
 *   重载会换掉 `props.service` 对象，从而触发详情页整表重填（丢掉未提交的编辑），
 *   并多打一次 MCP 实时探测（工具清单抖动 → 复选框清单与手填框来回切换 = "闪"）。
 * - **不带**（启停服务）→ 服务状态确实变了且没有新版本号，需重载详情刷新状态显示；
 *   此时详情页的表单草稿由"草稿锚定实体标识"守住（同服务刷新不回填），不会被覆盖。
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
  void loadList()
  void loadStats()
  if (props.detail) void loadDetail(props.detail)
})

watch(
  () => props.detail,
  (name) => {
    if (name) void loadDetail(name)
    else {
      serviceDetail.value = null
      void loadList()
    }
  },
)
</script>

<template>
  <section class="mcp-area">
    <McpServiceDetailView
      v-if="serviceDetail"
      :service="serviceDetail"
      :error="(error as never)"
      @back="
        () => {
          serviceDetail = null
          emit('navigate', '/mcp')
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
        @open="(name) => emit('navigate', `/mcp/${encodeURIComponent(name)}`)"
      />
    </template>
  </section>
</template>
