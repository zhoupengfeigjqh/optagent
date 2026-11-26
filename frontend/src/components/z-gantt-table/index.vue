<script setup lang="ts">
import type { ColumnsType } from '#/components/z-table/table.data'

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import ZGantt from '#/components/z-gantt/index.vue'
import { isTruth } from '#/utils/is'

const props = defineProps<{
  cols: any[]
  ganttData: any[]
  ganttOption: any
  isFixedBtn?: boolean
  navPosition?: 'bottom' | 'top'
  rowKey?: string
  tableData: any[]
}>()

const emit = defineEmits(['update:cols', 'handlePointDragStart', 'handlePointDragEnd', 'handlePointDraging'])

const navPaddingTop = 160
const normalPaddingTop = props.ganttOption.rangeSelector.enabled ? 90 : 55
const ganttRef = ref<any>(null)
const tableSectionRef = ref<any>(null)
const containerRef = ref<any>(null)
const showGuideLine = ref(false)
const guideLinePosition = ref(200)
const tableWidth = ref('200px')
const tempWidth = ref(0)
const handlerTop = ref(0)
const openTour = ref(false)
const tourRef = ref()
let isClick = true

const cols = computed<ColumnsType[]>({
  get: () => {
    const resizableCols = props.cols.map((col) => ({
      ...col,
      resizable: isTruth(col.resizable) ? col.resizable : true,
      minWidth: isTruth(col.minWidth) ? col.minWidth : 80,
      maxWidth: isTruth(col.maxWidth) ? col.maxWidth : 600,
      width: isTruth(col.width) ? col.width : 100,
      ellipsis: isTruth(col.ellipsis) ? col.ellipsis : true,
    }))
    return resizableCols
  },
  set: (val) => emit('update:cols', val),
})
const updateGantt = (option: any) => {
  if (ganttRef.value) ganttRef.value.updateGantt(option)
}
/**
 * 将可解析的时间字符串统一转为时间戳，避免 Highcharts 无法解析
 */
const toTimestamp = (value: any): any => {
  if (typeof value === 'string') {
    const ts = Date.parse(value)
    return Number.isNaN(ts) ? value : ts
  }
  return value
}
/**
 * 将外部甘特图数据规范化为 Highcharts Gantt 所需字段：
 * - startTime/endTime（接口常用字段）兼容转成 start/end
 * - 时间值统一为时间戳
 * - 缺失 y（行坐标）时按数据顺序补齐，保证每个点都能定位到行
 */
const normalizeGanttData = (list: any[] = []): any[] => {
  if (!Array.isArray(list)) return []
  return list.map((item: any, index: number) => {
    const hasStart = item.start !== undefined || item.x !== undefined
    const hasEnd = item.end !== undefined || item.x2 !== undefined
    return {
      ...item,
      start: toTimestamp(hasStart ? (item.start ?? item.x) : item.startTime),
      end: toTimestamp(hasEnd ? (item.end ?? item.x2) : item.endTime),
      y: item.y === undefined ? index : item.y,
    }
  })
}
const ganttChartData = computed<any[]>(() => normalizeGanttData(props.ganttData))
watch(
  () => props.ganttData,
  () => {
    if (!ganttRef.value) return
    nextTick(() => {
      // 携带最新的数据与 y 轴分类/范围，避免行数变化时出现截断或错位
      updateGantt(ganttOpt.value)
    })
  },
  { deep: true },
)
const ganttCtx: Record<string, any> = {}

const resolveGanttOption = (option: any): any =>
  typeof option === 'function' ? option(ganttCtx) : option || {}

const ganttOpt = computed(() => {
  const data = ganttChartData.value
  const rawOption = resolveGanttOption(props.ganttOption)
  const rawSeries = Array.isArray(rawOption?.series) ? rawOption.series : []
  const baseSeries = rawSeries.length > 0 ? rawSeries[0] : { name: '甘特图', turboThreshold: 0 }

  const rawYAxis = rawOption?.yAxis || {}
  const needAutoAxis = !Array.isArray(rawYAxis.categories) || rawYAxis.categories.length === 0
  const baseYAxis = needAutoAxis
    ? {
        ...rawYAxis,
        categories: data.map((d: any, index: number) => d?.name ?? `任务${index + 1}`),
        min: 0,
        max: Math.max(data.length - 1, rawYAxis.min ?? 0),
      }
    : { ...rawYAxis }

  return {
    ...rawOption,
    yAxis: {
      ...baseYAxis,
      grid: {
        ...baseYAxis.grid,
        enabled: true,
        borderColor: baseYAxis.grid?.borderColor ?? '#e0e0e0',
      },
      labels: { ...baseYAxis.labels, enabled: false, distance: 0.5 },
      // Highcharts 默认 y 轴标题为 'Values'，未显式配置时关闭，避免占位与文本绘制
      title: baseYAxis.title ?? { text: null },
      tickLength: 0,
      tickWidth: 0,
      lineWidth: baseYAxis.lineWidth ?? 1,
    },
    series: [{ ...baseSeries, data }, ...rawSeries.slice(1)],
  }
})
const handleMouseDown = (e: MouseEvent) => {
  e.preventDefault()
  showGuideLine.value = true
  if (tableSectionRef.value) {
    tempWidth.value = tableSectionRef.value.offsetWidth
  }

  if (containerRef.value) {
    const containerRect = containerRef.value.getBoundingClientRect()
    guideLinePosition.value = e.clientX - containerRect.left
  }

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}
const handleMouseMove = (e: MouseEvent) => {
  e.preventDefault()
  isClick = false
  if (!containerRef.value) return

  const containerRect = containerRef.value.getBoundingClientRect()
  const minWidth = 100
  const maxWidth = containerRect.width * 0.6

  let newWidth = e.clientX - containerRect.left
  newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth))

  guideLinePosition.value = newWidth
  tempWidth.value = newWidth
}
const handleMouseUp = () => {
  showGuideLine.value = false
  tableWidth.value = `${tempWidth.value}px`
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  const timer = setTimeout(() => {
    isClick = true
    clearTimeout(timer)
  }, 1000)
}
function handleResizeColumn(w: any, col: any) {
  cols.value = cols.value.map((item) =>
    item.dataIndex === col.dataIndex ? { ...item, width: w } : item,
  )
}
const handleScroll = () => {
  const base = props.navPosition === 'top' ? navPaddingTop : normalPaddingTop
  handlerTop.value = base + window.scrollY
}

const handleVisibleTable = () => {
  if (isClick) {
    tableWidth.value = tableWidth.value === '0px' ? '100px' : '0px'
    guideLinePosition.value = tableWidth.value === '0px' ? 0 : 100
  }
}

const handlePointDragStart = (event: any) => {
  emit('handlePointDragStart', event)
}
const handlePointDraging = (event: any) => {
  emit('handlePointDraging', event)
}
const handlePointDragEnd = (event: any) => {
  emit('handlePointDragEnd', event)
}

onMounted(() => {
  if (tableSectionRef.value) {
    tableWidth.value = `${tableSectionRef.value.offsetWidth}px`
  }
  handlerTop.value = props.navPosition === 'top' ? navPaddingTop : normalPaddingTop

  const timer = setTimeout(() => {
    const hasDragedHandler = localStorage.getItem('hasDragedHandler')
    if (!hasDragedHandler) {
      localStorage.setItem('hasDragedHandler', '1')
      openTour.value = true
    }
    clearTimeout(timer)
  }, 1500)
  if (!props?.isFixedBtn) window.addEventListener('scroll', handleScroll)
})
onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  if (!props?.isFixedBtn) window.removeEventListener('scroll', handleScroll)
})

const steps = [
  {
    title: '拖拽句柄',
    description: '拖拽该按钮可调节表格与甘特图的宽度',
    target: () => tourRef.value && tourRef.value.$el,
  },
]

defineExpose({
  updateGantt,
  handlePointDragStart,
  handlePointDragEnd,
  handlePointDraging,
})
</script>

<template>
  <div>
    <main id="gantt-table-container" ref="containerRef" class="of-hidden relative flex">
      <a-button
        ref="tourRef"
        class="drag-handler"
        :style="{
          left: `${guideLinePosition}px`,
          top: `${handlerTop}px`,
        }"
        @click="handleVisibleTable"
        @mousedown="handleMouseDown"
      />

      <div
        v-if="showGuideLine"
        class="guide-line"
        :style="{ left: `${guideLinePosition}px` }"
      ></div>

      <section
        v-show="tableWidth !== '0px'"
        ref="tableSectionRef"
        class="table-section"
        :style="{
          paddingTop: props.navPosition === 'top' ? `${navPaddingTop}px` : `${normalPaddingTop}px`,
          width: tableWidth,
          minWidth: '100px',
          maxWidth: '60%',
        }"
      >
        <a-table
          :row-key="props.rowKey || 'id'"
          :columns="cols"
          :data-source="props.tableData"
          :pagination="false"
          size="small"
          bordered
          @resize-column="handleResizeColumn"
        >
          <template #bodyCell="{ column, record, text }">
            <template v-if="column.slot">
              <slot :name="column.slot" :record="record" :text="text" :column="column"></slot>
            </template>
            <template v-else>
              {{ text }}
            </template>
          </template>
        </a-table>
      </section>

      <div class="min-w-0 flex-1">
        <ZGantt
          ref="ganttRef"
          :option="ganttOpt"
          :data="ganttChartData"
          :context="ganttCtx"
          :nav-position="props.navPosition"
          @handlePointDragStart="handlePointDragStart"
          @handlePointDragEnd="handlePointDragEnd"
          @handlePointDraging="handlePointDraging"
        />
      </div>
    </main>

    <a-tour :open="openTour" :steps="steps" @close="openTour = false" />
  </div>
</template>

<style lang="scss" scoped>
$th-height: 30px;
$td-height: 33px;

.drag-handler {
  position: absolute;
  z-index: 20;
  width: 1rem;
  height: 2rem;
  padding: 0 !important;
  cursor: col-resize !important;
  background: #bdb8ae;
  background: linear-gradient(to right, #f7f2f6, #ccc6b9);
  border: none !important;
  border-radius: 8px;
  box-shadow:
    inset 1px 1px 0 white,
    0 0 4px rgb(0 0 0 / 15%),
    0 4px 4px rgb(0 0 0 / 15%);
  transform: translate(-50%, -100%);
  transition: top 0.1s ease-in;

  &::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 50%;
    height: 60%;
    content: '';
    background: #e9e1d8;
    background: linear-gradient(to right, #d8d6d1, #e2ddd8);
    border-radius: 4px;
    box-shadow: inset -1px -1px 0 rgb(231 231 186);
    transform: translate(-50%, -50%);
  }
}

.table-section {
  transition: width 0.3s ease;
}

.guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 19;
  width: 2px;
  pointer-events: none;
  background: repeating-linear-gradient(
    to bottom,
    #1890ff 0,
    #1890ff 4px,
    transparent 4px,
    transparent 8px
  );
}

:deep(.ant-table-thead .ant-table-cell) {
  height: $th-height !important;
  line-height: $th-height !important;
}

:deep(.ant-table-tbody .ant-table-cell) {
  height: $td-height !important;
  line-height: $td-height !important;
}

:deep(
  .ant-table-wrapper
    .ant-table.ant-table-bordered
    > .ant-table-container
    > .ant-table-content
    > table
    > tbody
    > tr
    > td:last-child
) {
  border-inline-end: none;
}

:deep(
  .ant-table-wrapper
    .ant-table.ant-table-bordered
    > .ant-table-container
    > .ant-table-content
    > table
    > thead
    > tr
    > th:last-child
) {
  border-inline-end: none;
}

:deep(.ant-table-wrapper .ant-table-container table > thead > tr:first-child > *:last-child) {
  border-start-end-radius: 0;
}
</style>
