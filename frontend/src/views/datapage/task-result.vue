<!--
 * 排产任务结果页（/taskresult）
 *
 * 页面结构：标题 → 排产结果指标 → 排产结果甘特图（含导出）
 *   → 工单加工计划 / 产线利用率 / 产线加工计划 三张分页表格。
 * 数据来源 `/dataApi/scheduling/*`（`@/api/datapage`）；
 * 路由查询参数与 `datapage.vue` 同口径：userId / conversationId / sourceType / sourceValue，
 * 另兼容 taskId / taskNo（两者互为兜底，随公共参数传入所有接口）。
-->
<template>
  <div class="min-h-full bg-[#f5f6fa] p-4">
    <!-- 1. 标题栏：标题 + 排产时间范围 + 任务概览 -->
    <header class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-white px-5 py-4">
      <h1 class="m-0 text-lg font-bold">排产任务结果</h1>
      <span v-if="timeRange" class="text-sm text-gray-400">{{ timeRange }}</span>
      <div class="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span class="text-gray-500">
          总任务
          <b class="ml-1 text-base text-gray-800">{{ metricValue('productionOrderCount') }}</b>
        </span>
        <!-- <span class="text-gray-500">
          设备
          <b class="ml-1 text-base text-gray-800">{{ metricValue('lineCount') }}</b>
        </span> -->
        <span class="text-gray-500">
          总时长
          <b class="ml-1 text-base text-gray-800">{{ totalDurationText }}</b>
        </span>
      </div>
    </header>

    <!-- 2. 排产结果指标 -->
    <a-spin :spinning="loading.metrics">
      <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <div
          v-for="card in metricCards"
          :key="card.key"
          class="relative overflow-hidden rounded-lg bg-white px-5 py-4"
        >
          <span class="absolute inset-y-0 left-0 w-1" :style="{backgroundColor: card.color}"></span>
          <div class="text-sm text-gray-500">{{ card.label }}</div>
          <div class="mt-1 text-2xl font-bold leading-8">{{ metricValue(card.key) }}</div>
          <div class="mt-0.5 text-xs text-gray-400">{{ card.sub }}</div>
        </div>
      </div>
    </a-spin>

    <!-- 3. 排产结果甘特图（标题栏右侧为导出入口） -->
    <ExpandSection title="排产结果甘特图" class="mb-4 overflow-hidden rounded-lg">
      <template #extra>
        <a-button :loading="loading.export" @click="handleExport">导出</a-button>
      </template>

      <a-spin :spinning="loading.gantt">
        <!-- 图例：常规 / 加药+加色 / 仅加药 / 仅加色 / 切换准备 -->
        <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-gray-600">
          <span v-for="item in legendItems" :key="item.key" class="flex items-center gap-1">
            <span class="inline-block h-3 w-3 rounded-sm" :style="{backgroundColor: item.color}"></span>
            {{ item.label }}
          </span>
        </div>

        <ZGanttTable
          v-if="ganttPoints.length > 0"
          v-model:cols="ganttCols"
          :gantt-data="ganttPoints"
          :gantt-option="ganttOption"
          :table-data="ganttRows"
          row-key="id"
          :is-fixed-btn="true"
        >
          <!-- 设备列：产线名称在上、编号在下两行展示 -->
          <template #device="{record}">
            <div class="leading-tight">
              <div class="font-medium">{{ record.name }}</div>
              <div class="text-xs text-gray-400">{{ record.id }}</div>
            </div>
          </template>
        </ZGanttTable>
        <a-empty v-else-if="!loading.gantt" description="暂无排产结果" />
      </a-spin>
    </ExpandSection>

    <!-- 4. 工单加工计划 -->
    <ExpandSection title="工单加工计划" class="mb-4 overflow-hidden rounded-lg">
      <a-table
        :columns="overallCols"
        :data-source="overallRows"
        :loading="loading.overall"
        :scroll="{x: 'max-content'}"
        :pagination="false"
        row-key="id"
        size="small"
      />
      <div class="mt-3 flex items-center justify-between">
        <div class="text-xs text-gray-400">
          第 {{ overallState.pageNum }} / {{ overallTotalPages }} 页，共 {{ overallTotal }} 条
        </div>
        <a-pagination
          v-model:current="overallState.pageNum"
          :page-size="overallState.pageSize"
          :total="overallTotal"
          @change="fetchOverall"
        />
      </div>
    </ExpandSection>

    <!-- 5. 产线利用率 -->
    <ExpandSection title="产线利用率" class="mb-4 overflow-hidden rounded-lg">
      <a-table
        :columns="usageCols"
        :data-source="usageRows"
        :loading="loading.usage"
        :scroll="{x: 'max-content'}"
        :pagination="false"
        row-key="id"
        size="small"
      />
      <div class="mt-3 flex items-center justify-between">
        <div class="text-xs text-gray-400">
          第 {{ usageState.pageNum }} / {{ usageTotalPages }} 页，共 {{ usageTotal }} 条
        </div>
        <a-pagination
          v-model:current="usageState.pageNum"
          :page-size="usageState.pageSize"
          :total="usageTotal"
          @change="fetchUsage"
        />
      </div>
    </ExpandSection>

    <!-- 6. 产线加工计划 -->
    <ExpandSection title="产线加工计划" class="mb-4 overflow-hidden rounded-lg">
      <a-table
        :columns="linePlanCols"
        :data-source="linePlanRows"
        :loading="loading.linePlan"
        :scroll="{x: 'max-content'}"
        :pagination="false"
        row-key="id"
        size="small"
      />
      <div class="mt-3 flex items-center justify-between">
        <div class="text-xs text-gray-400">
          第 {{ linePlanState.pageNum }} / {{ linePlanTotalPages }} 页，共 {{ linePlanTotal }} 条
        </div>
        <a-pagination
          v-model:current="linePlanState.pageNum"
          :page-size="linePlanState.pageSize"
          :total="linePlanTotal"
          @change="fetchLinePlan"
        />
      </div>
    </ExpandSection>
  </div>
</template>

<script setup lang="ts">
import type { Ref } from 'vue'

import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'

import ExpandSection from '#/components/expand-section/expand-section.vue'
import ZGanttTable from '#/components/z-gantt-table/index.vue'

import {
  exportSchedulingApi,
  getGanttApi,
  getLinePlanListApi,
  getLineUsageRateListApi,
  getMetricsApi,
  getOverallPlanListApi,
} from '@/api/datapage'
import {
  buildTaskGanttOption,
  formatDuration,
  legendItems,
  linePlanColumns,
  lineUsageRateColumns,
  metricCards,
  overallPlanColumns,
  productionPlanGantt,
  productionPlanMetrics,
  toTaskGanttData,
} from './task-result.data'

/* ---------- 后端载荷类型（axios 拦截器返回的是 response.data 业务体） ---------- */

/** 通用业务响应：字段全部可选以兼容拦截器的透传行为 */
interface ApiResult<T = unknown> {
  code?: number
  data?: T
  message?: string
}

/** 分页数据体（后端分页契约：records / total / pageNum / pageSize） */
interface PageData {
  records?: TableRow[]
  total?: number
  pageNum?: number
  pageSize?: number
}

/** 表格行：后端字段动态，按字符串索引读取 */
type TableRow = Record<string, unknown>

/** 排产结果指标（字段同 task-result.data.js 的 productionPlanMetrics） */
type MetricItem = Record<string, string | number>

/** 甘特图色块 */
interface GanttBlock {
  blockId?: string
  id?: string
  isSwitch?: boolean | number
  isDosing?: boolean | number
  isColoring?: boolean | number
  productId?: string
  productName?: string
  productionQuantity?: number | string
  processTime?: number
  changeTime?: number
  blockStartTime?: string
  blockEndTime?: string
  changeStartTime?: string
  processEndTime?: string
  productionLineName?: string
}

/** 甘特图产线行 */
interface GanttLine {
  productionLineId?: string
  productionLineName?: string
  blocks?: GanttBlock[]
}

/** 排产结果甘特图响应体 */
interface GanttData {
  taskNo?: string
  lineCount?: number
  blockCount?: number
  lines?: GanttLine[]
}

/** 列表接口公共查询参数（与 datapage.vue 的 pageState 同口径 + 任务标识） */
interface TaskQuery {
  userId: number | string
  conversationId: string
  sourceType: string
  sourceValue: string
  taskId: string
  taskNo: string
}

/** 分页状态 */
interface PageState {
  pageNum: number
  pageSize: number
}

/** label/prop 形式的列配置（task-result.data.js 导出格式） */
interface ColumnConfig {
  title: string
  dataIndex: string
  width?: number
  customRender?: (text: string | number) => any
  align?: 'center' | 'left' | 'right'
}

/** 甘特图左侧表格列 */
interface GanttCol {
  title: string
  dataIndex: string
  key: string
  slot: string
  width: number
}

const route = useRoute()

const baseQuery = reactive<TaskQuery>({
  userId: 111,
  conversationId: '',
  sourceType: '',
  sourceValue: '',
  taskId: '',
  taskNo: '',
})

/** 各接口加载状态 */
const loading = reactive({
  metrics: false,
  gantt: false,
  export: false,
  overall: false,
  usage: false,
  linePlan: false,
})

/* ---------- 2. 排产结果指标 ---------- */

/** 指标数据：以 task-result.data.js 中的结构为初始模板，请求后合并替换 */
const metrics = ref<MetricItem>({...productionPlanMetrics.value})

/** 空串 / 空值统一展示 0，避免卡片出现空白 */
function metricValue(key: string): string | number {
  const value = metrics.value[key]
  return value === '' || value === null || value === undefined ? 0 : value
}

/** 标题栏时间范围：排产开始时间 ~ 最迟完工时间 */
const timeRange = computed(() => {
  const start = metrics.value.schedulingStartTime
  const end = metrics.value.latestFinishTime
  if (!start && !end) return ''
  return `${start || '--'} ~ ${end || '--'}`
})

const totalDurationText = computed(() => formatDuration(metrics.value.totalDurationMinutes))

/* ---------- 3. 排产结果甘特图 ---------- */

/** 甘特图数据：以 task-result.data.js 中的结构为初始模板（lines 置空） */
const gantt = ref<GanttData>({...productionPlanGantt.value, lines: []})

const ganttLines = computed<GanttLine[]>(() => gantt.value.lines || [])

/** 甘特图左侧表格行：产线名称 + 编号 */
const ganttRows = computed(() =>
  ganttLines.value.map((line, index) => ({
    id: line.productionLineId || `line-${index}`,
    name: line.productionLineName || line.productionLineId || `产线 ${index + 1}`,
  })),
)

/** 甘特图数据点（色块按加药 / 加色 / 切换取色） */
const ganttPoints = computed(() => toTaskGanttData(ganttLines.value))

/** y 轴分类：产线名称（轴标签由 ZGanttTable 内部关闭，仅左侧表格展示） */
const ganttCategories = computed(() =>
  ganttLines.value.map((line) => line.productionLineName || line.productionLineId || ''),
)

/** 甘特图左侧表格列：设备（slot 两行展示） */
const ganttCols = ref<GanttCol[]>([
  {title: '设备', dataIndex: 'name', key: 'device', slot: 'device', width: 130},
])

const ganttOption = computed(() => buildTaskGanttOption(ganttCategories.value))

/* ---------- 4/5/6. 三张分页表格 ---------- */

/** label/prop 列配置 → a-table 列（ellipsis 等价于溢出省略） */
const toColumns = (cols: ColumnConfig[]) =>
  cols.map((col) => ({
    title: col.title,
    dataIndex: col.dataIndex,
    width: col.width,
    ellipsis: true,
    customRender: col.customRender,
    align: col.align || 'center',
  }))

const overallCols = toColumns(overallPlanColumns)
const usageCols = toColumns(lineUsageRateColumns)
const linePlanCols = toColumns(linePlanColumns)

const overallState = reactive<PageState>({pageNum: 1, pageSize: 10})
const usageState = reactive<PageState>({pageNum: 1, pageSize: 10})
const linePlanState = reactive<PageState>({pageNum: 1, pageSize: 10})

const overallTotal = ref(0)
const usageTotal = ref(0)
const linePlanTotal = ref(0)

const overallRows = ref<TableRow[]>([])
const usageRows = ref<TableRow[]>([])
const linePlanRows = ref<TableRow[]>([])

const totalPages = (total: number, pageSize: number) => Math.max(Math.ceil(total / pageSize), 1)
const overallTotalPages = computed(() => totalPages(overallTotal.value, overallState.pageSize))
const usageTotalPages = computed(() => totalPages(usageTotal.value, usageState.pageSize))
const linePlanTotalPages = computed(() => totalPages(linePlanTotal.value, linePlanState.pageSize))

/** 分页查询通用流程：records / total / pageNum / pageSize 同后端分页契约 */
async function fetchPage(
  api: (params: TaskQuery & PageState) => Promise<ApiResult<PageData>>,
  state: PageState,
  total: Ref<number>,
  rows: Ref<TableRow[]>,
  loadingKey: 'overall' | 'usage' | 'linePlan',
) {
  loading[loadingKey] = true
  try {
    const res: ApiResult<PageData> = await api({
      ...baseQuery,
      pageNum: state.pageNum,
      pageSize: state.pageSize,
    })
    if (res.code === 200) {
      const data: PageData = res.data || {}
      rows.value = data.records || []
      total.value = data.total || 0
      state.pageNum = data.pageNum || state.pageNum
      state.pageSize = data.pageSize || state.pageSize
    }
  } catch {
    // 业务错误已由 axios 拦截器统一提示
  } finally {
    loading[loadingKey] = false
  }
}

const fetchOverall = () =>
  fetchPage(getOverallPlanListApi, overallState, overallTotal, overallRows, 'overall')
const fetchUsage = () =>
  fetchPage(getLineUsageRateListApi, usageState, usageTotal, usageRows, 'usage')
const fetchLinePlan = () =>
  fetchPage(getLinePlanListApi, linePlanState, linePlanTotal, linePlanRows, 'linePlan')

/* ---------- 数据获取 ---------- */

async function fetchMetrics() {
  loading.metrics = true
  try {
    const res: ApiResult<MetricItem> = await getMetricsApi({...baseQuery})
    if (res.code === 200 && res.data) {
      metrics.value = {...metrics.value, ...res.data}
    }
  } catch {
    // 业务错误已由 axios 拦截器统一提示
  } finally {
    loading.metrics = false
  }
}

async function fetchGantt() {
  loading.gantt = true
  try {
    const res: ApiResult<GanttData> = await getGanttApi({...baseQuery})
    if (res.code === 200 && res.data) {
      gantt.value = {...gantt.value, ...res.data}
    }
  } catch {
    // 业务错误已由 axios 拦截器统一提示
  } finally {
    loading.gantt = false
  }
}

/** 导出排产结果 Excel：blob 流 → 触发浏览器下载 */
async function handleExport() {
  loading.export = true
  try {
    const res: Blob | ApiResult = await exportSchedulingApi({...baseQuery})
    // 后端异常时可能仍返回 JSON（blob 形态下表现为 type 含 application/json）
    if (res instanceof Blob && res.type.includes('json')) {
      const text = await res.text()
      let msg = '导出失败'
      try {
        msg = JSON.parse(text)?.message || msg
      } catch {
        // 保留默认文案
      }
      message.error(msg)
      return
    }
    if (!(res instanceof Blob)) return
    const url = URL.createObjectURL(res)
    const link = document.createElement('a')
    link.href = url
    link.download = `排产结果${baseQuery.taskNo ? `-${baseQuery.taskNo}` : ''}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
    message.success('导出成功')
  } catch {
    // 业务错误已由 axios 拦截器统一提示
  } finally {
    loading.export = false
  }
}

/** 首屏初始化：解析路由查询参数并并行拉取全部数据 */
onMounted(() => {
  const {userId, conversationId, sourceType, sourceValue, taskId, taskNo} = route.query
  baseQuery.userId = String(userId ?? '') || 111
  baseQuery.conversationId = String(conversationId ?? '')
  baseQuery.sourceType = String(sourceType ?? '')
  baseQuery.sourceValue = String(sourceValue ?? '')
  // 任务标识：taskId / taskNo 互为兜底，接口各自取需要的字段
  baseQuery.taskId = String(taskId ?? taskNo ?? '')
  baseQuery.taskNo = String(taskNo ?? taskId ?? '')

  fetchMetrics()
  fetchGantt()
  fetchOverall()
  fetchUsage()
  fetchLinePlan()
})
</script>
