<script setup lang="ts">
/**
 * MCP 服务功能区：卡片列表 ↔ 服务详情（调用配置、工具清单、调用统计），外加**新建弹窗**。
 *
 * **2026-09-27**：MCP 服务由管理员在平台内**全人工登记**（新建/编辑/删除），
 * 不再从容器编排声明派生；启停与运行日志已下架。
 *
 * **新建走弹窗**（`McpCreateDialog`）：弹窗只收基础连接信息，创建成功后导航到该服务的
 * 详情页补全其余调用配置，并**自动测试一次**。之所以不在弹窗里测：`POST /{name}/test`
 * 只接受**已登记**的服务（服务不存在 → `ADM_MCP_SERVICE_NOT_FOUND`），
 * 所以测试时机是"创建后立刻"而非"创建前"。
 *
 * **2026-10-15 工具范围可调整**：详情页「工具清单」的「重新探测」不再只是刷新——
 * 探测成功后本组件立即打开 `McpToolScopeDialog`（勾选增减可见工具，保存走 `PUT`）。
 * 开窗开关与"探测是否成功"的判断都放在这里：只有拿到详情结果的这一层才知道
 * 清单可不可信（探测失败时开窗等于让管理员凭空造范围）。
 */
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
/**
 * 当前打开的服务名（路由参数）：**一变就切到详情视图**，不等详情接口返回（方案 B，2026-09-28）。
 * 与 `serviceDetail` 解耦，正是"立即反馈"与"数据到手"两件事分开的落点。
 */
const openedName = ref<string | null>(null)
/** 详情是否正在读取（后端会**同步探测** MCP 服务以取工具清单，慢服务可达数秒） */
const detailLoading = ref(false)
/** 当前打开的服务详情（与 props.detail 同名会与路由参数混淆，故显式改名） */
const serviceDetail = ref<McpServiceDetail | null>(null)
const stats = ref<McpStatsItem[]>([])
const statsAvailable = ref(true)

/** 新建弹窗开关 */
const createOpen = ref(false)
/** 工具范围弹窗开关（2026-10-15）：由「重新探测」**成功**后打开 */
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

/**
 * 读取详情。`detailLoading` 只表达"数据未到手"，与"是否已切到详情视图"解耦。
 * 失败时清掉旧数据：停在详情壳里给出错误与重试，而不是留着上一个服务的内容。
 */
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

/** 路由 detail 变化 → 切换列表 / 详情；刚创建的服务在详情就绪后自动测一次 */
async function syncFromRoute(name: string | null): Promise<void> {
  // **先切视图、再取数据**：点卡片后立刻进入详情壳（标题已可读、正文显示加载中），
  // 不必等后端那次 MCP 实时探测返回（方案 B，2026-09-28）
  openedName.value = name
  // 路由一动就收起工具范围弹窗：它是"针对某个服务的一次调整"，
  // 跨服务留着只会张冠李戴（把 A 的勾选画在 B 的清单上）
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
  // 先清标志，保证只测一次（之后任何重载都不再触发）
  pendingAutoTest.value = null
  if (!serviceDetail.value) return
  await nextTick()
  emit('announce', '服务已创建，正在自动测试连接…')
  void detailRef.value?.runTest()
}

/** 详情读取失败后的「重试」（重新拉取当前打开的服务） */
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

/**
 * 工具范围保存成功：**原地**更新白名单与 `revision`，MUST NOT 重载详情
 * （契约 §0.5 原则 ①②：重载会整表重填、丢掉未提交的配置草稿，并多打一次实时探测）。
 *
 * 但 `tools` 与 `missing_tools` 必须用**本次探测到的全量清单**重新投影：
 * 留着旧投影的话，刚勾进来的工具会落进"已不存在"分支——那是假告警。
 */
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
  // 卡片列表带 `allowed_tools`（数字人问题实例的可选项来源），改了范围要跟着刷
  void loadList()
}

/** 弹窗创建成功：关弹窗、记下待测服务、导航到其详情页 */
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
    <!-- 只要"有打开的服务名"就渲染详情（哪怕数据还没到手）：立即反馈，不等探测 -->
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

    <!-- 工具范围弹窗（2026-10-15）：`serviceDetail` 到手才渲染——`kind` 与清单都取自它 -->
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
