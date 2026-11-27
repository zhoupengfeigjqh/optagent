<script setup lang="ts">
import { getCurrentInstance, onMounted, ref, watch } from 'vue'
import { useThrottleFn } from '@vueuse/core'

import Highcharts from './static/js/gantt.js'
import { getPresetOptions } from '#/components/z-gantt/static/config/presetConfig.js'

const props = defineProps<{
  presetOptions?: ReturnType<typeof getPresetOptions> | Record<string, any>
  option?: Record<string, any> | ((ctx: Record<string, any>) => any)
  context?: Record<string, any>
  data?: any[]
  navPosition?: 'top' | 'bottom'
}>()

const emit = defineEmits<{
  (e: 'handlePointClick', event: any): void
  (e: 'handlePointClickMouseY', event: any): void
  (e: 'handlePointDblclick', event: any): void
  (e: 'handlePointDragStart', event: any): void
  (e: 'handlePointDraging', event: any): void
  (e: 'handlePointDragEnd', event: any): void
  (e: 'handleViewChange', event: { xMin: number; xMax: number; yMin: number; yMax: number }): void
}>()

const myChart = ref<any>(null)

let chartInstance: any = null

const navigatorContainer = ref<any>(null)

let navInstance: any = null

let isSyncing = false

const emitViewChange = () => {
  if (chartInstance && !isSyncing) {
    const xAxis = chartInstance.xAxis[0]
    const yAxis = chartInstance.yAxis[0]
    emit('handleViewChange', {
      xMin: xAxis.min,
      xMax: xAxis.max,
      yMin: yAxis.min,
      yMax: yAxis.max,
    })
  }
}

const normalizeTooltipFormatter = (option: any): any => {
  if (!option) return option
  const { __ganttCtx: ganttCtx, ...cleanOption } = option
  if (typeof option?.tooltip?.formatter !== 'function') {
    return ganttCtx ? cleanOption : option
  }
  const { formatter, ...restTooltip } = option.tooltip
  return {
    ...cleanOption,
    tooltip: {
      ...restTooltip,
      style: {
        ...restTooltip.style,
        zIndex: 21,
      },
      formatter: function (this: any, ...args: any[]) {
        const first = args[0]
        const isCtx = (v: any) => v && (v.point || v.label || v.series)
        const context = isCtx(this) ? this : isCtx(first) ? first : (this ?? first ?? {})
        if (ganttCtx && typeof ganttCtx === 'object') {
          ganttCtx.point = context?.point ?? context
          ganttCtx.tooltip = context
        }
        return formatter.apply(context, [context, ...args])
      },
    },
  }
}

const instance = getCurrentInstance()

const runtimeCtx: Record<string, any> = props.context ?? {}
runtimeCtx.instance = runtimeCtx.instance ?? instance

const resolveOption = (option: any): any =>
  typeof option === 'function' ? option(runtimeCtx) : option || {}

const bindMouseTracker = (chart: any, ganttCtx: Record<string, any>) => {
  const container = chart?.container
  if (!container || container._ganttMouseBound) return
  container._ganttMouseBound = true
  const updateMousePosition = useThrottleFn((event: MouseEvent) => {
    const rect = container.getBoundingClientRect()
    const scrollLeft = chart?.scrollingContainer?.scrollLeft ?? 0
    ganttCtx.mouseX = event.clientX - rect.left + scrollLeft
    ganttCtx.mouseY = event.clientY - rect.top
  }, 100)
  container.addEventListener('mousemove', (event: MouseEvent) => updateMousePosition(event))
  container.addEventListener('mouseleave', () => {
    ganttCtx.mouseX = undefined
    ganttCtx.mouseY = undefined
  })
}

const withRuntimeCtx = (option: any): any => {
  const { __ganttCtx, ...restOption } = option || {}
  const ganttCtx = __ganttCtx ?? runtimeCtx
  const userLoad = restOption?.chart?.events?.load
  const dataLabels = restOption?.plotOptions?.gantt?.dataLabels
  const userLabelFormatter = dataLabels?.formatter
  return {
    ...restOption,
    __ganttCtx: ganttCtx,
    chart: {
      ...restOption?.chart,
      events: {
        ...restOption?.chart?.events,
        load() {
          const chart: any = this
          ganttCtx.chart = chart
          bindMouseTracker(chart, ganttCtx)
          // 兼容业务侧自定义的 load 钩子
          if (typeof userLoad === 'function') userLoad.call(chart)
        },
      },
    },
    ...(typeof userLabelFormatter === 'function'
      ? {
          plotOptions: {
            ...restOption.plotOptions,
            gantt: {
              ...restOption?.plotOptions?.gantt,
              dataLabels: {
                ...dataLabels,
                formatter(this: any, ...args: any[]) {
                  ganttCtx.point = this?.point ?? ganttCtx.point
                  return userLabelFormatter.call(this, ganttCtx, ...args)
                },
              },
            },
          },
        }
      : {}),
  }
}

const initGantt = (option: any) => {
  if (myChart.value && option) {
    const ganttOpt = resolveOption(option)
    chartInstance = Highcharts.ganttChart(
      myChart.value as HTMLElement,
      normalizeTooltipFormatter(withRuntimeCtx(ganttOpt)),
    )

    Highcharts.addEvent(chartInstance.xAxis[0], 'afterSetExtremes', () => {
      emitViewChange()
    })

    Highcharts.addEvent(chartInstance.yAxis[0], 'afterSetExtremes', () => {
      emitViewChange()
    })

    if (props.navPosition && navigatorContainer.value) {
      // 获取主图表的 Y 轴配置，确保导航器与之同步
      const mainYAxis = ganttOpt.yAxis || {}

      // 构建导航器概览数据（确保颜色等属性被正确保留）
      const overviewData = buildOverviewData(ganttOpt.series[0].data)

      navInstance = Highcharts.navigator(navigatorContainer.value, {
        liveRedraw: true,
        yAxis: {
          type: mainYAxis.type,
          categories: mainYAxis.categories,
          // 导航器的 Y 轴需要与主图表相反，因为导航器是倒置显示的
          reversed: !mainYAxis.reversed,
          minPadding: 0,
          maxPadding: 0,
          startOnTick: true,
          endOnTick: true,
        },
        series: {
          type: 'gantt',
          data: overviewData,
          pointPlacement: 0.5,
          pointPadding: 0.25,
        },
      })
      navInstance.bind(chartInstance)

      if (navInstance.navigator && navInstance.navigator.chart) {
        Highcharts.addEvent(navInstance.navigator.chart.xAxis[0], 'afterSetExtremes', () => {
          emitViewChange()
        })

        Highcharts.addEvent(navInstance.navigator.chart.yAxis[0], 'afterSetExtremes', () => {
          emitViewChange()
        })
      }

      if (navInstance && navInstance.navigator) {
        if (!navInstance.navigator.navigatorOptions) {
          navInstance.navigator.navigatorOptions = {}
        }
        navInstance.navigator.navigatorOptions.top = navInstance.navigator.top
        navInstance.navigator.navigatorOptions.left = navInstance.navigator.left
      }

      syncNavigatorYAxis()
    }
  }
}
const handlePointClick = (event: any) => {
  emit('handlePointClick', event)
}
const handlePointClickMouseY = (event: any) => {
  emit('handlePointClickMouseY', event)
}
const handlePointDblclick = (event: any) => {
  emit('handlePointDblclick', event)
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
const setPresetOptions = () => {
  const instance = getCurrentInstance()
  const resolvedPresetOptions = props.presetOptions ?? getPresetOptions(instance?.exposed)

  Highcharts.setOptions(resolvedPresetOptions)
}
onMounted(() => {
  setPresetOptions()
  initGantt(props.option)
})
const buildOverviewData = (seriesData: any[]) => {
  return seriesData
    .map((item: any) => ({
      x: item.x || item.start,
      x2: item.x2 || item.end,
      y: item.y !== undefined ? item.y : 0,
      name: item.name,
      color: item.color,
      partialFill: item.partialFill,
      accessibility: item.accessibility,
    }))
    .filter((item: any) => item.x && item.x2)
}

const syncNavBand = (min: number, max: number) => {
  if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
    navInstance.navigator.chart.xAxis[0]?.setExtremes(min, max, false)
  }
}

const syncNavigatorYAxis = () => {
  if (chartInstance && navInstance && navInstance.navigator && navInstance.navigator.chart) {
    const mainYAxis = chartInstance.yAxis[0]
    const navYAxis = navInstance.navigator.chart.yAxis[0]

    if (mainYAxis && navYAxis) {
      navYAxis.setExtremes(mainYAxis.min, mainYAxis.max, false)
    }
  }
}

const updateGantt = (option: any) => {
  if (chartInstance && option) {
    const ganttOpt = resolveOption(option)
    chartInstance.update(normalizeTooltipFormatter(withRuntimeCtx(ganttOpt)))
    if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
      const seriesData = ganttOpt.series?.[0]?.data || []
      const overviewData = buildOverviewData(seriesData)
      navInstance.navigator.chart.series[0]?.setData(overviewData, false)
      // 确保颜色设置始终生效
      navInstance.navigator.chart.series[0]?.update(
        {
          colorByPoint: false,
        },
        false,
      )
      syncNavBand(chartInstance.xAxis[0].min, chartInstance.xAxis[0].max)
      syncNavigatorYAxis()
      navInstance.navigator.chart.redraw()
    }
  }
}

const syncView = (xMin: number, xMax: number, yMin?: number, yMax?: number) => {
  if (chartInstance) {
    isSyncing = true
    chartInstance.xAxis[0].setExtremes(xMin, xMax, false)
    if (yMin !== undefined && yMax !== undefined) {
      chartInstance.yAxis[0].setExtremes(yMin, yMax, false)
    }
    chartInstance.redraw()
    if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
      navInstance.navigator.chart.xAxis[0]?.setExtremes(xMin, xMax, false)
      if (yMin !== undefined && yMax !== undefined) {
        navInstance.navigator.chart.yAxis[0]?.setExtremes(yMin, yMax, false)
      }
      navInstance.navigator.chart.redraw()
    }
    isSyncing = false
  }
}

watch(
  () => props.data,
  (newVal) => {
    if (myChart.value && newVal) {
      chartInstance.series[0]?.setData(JSON.parse(JSON.stringify(newVal)))
      if (
        (props.navPosition, navInstance && navInstance.navigator && navInstance.navigator.chart)
      ) {
        const overviewData = buildOverviewData(newVal)
        navInstance.navigator.chart.series[0]?.setData(overviewData, false)
        syncNavBand(chartInstance.xAxis[0].min, chartInstance.xAxis[0].max)
        syncNavigatorYAxis()
        navInstance.navigator.chart.redraw()
      }
    }
  },
)
const containerRef = ref()

defineExpose({
  updateGantt,
  syncView,
  handlePointClick,
  handlePointClickMouseY,
  handlePointDblclick,
  handlePointDragStart,
  handlePointDraging,
  handlePointDragEnd,
})
</script>

<template>
  <div ref="containerRef">
    <a-affix
      v-if="props.navPosition === 'top'"
      :offset-top="100"
      style="position: relative; z-index: 99"
      :target="() => containerRef.value"
    >
      <div ref="navigatorContainer"></div>
    </a-affix>

    <div ref="myChart"></div>

    <a-affix
      v-if="props.navPosition === 'bottom'"
      :offset-bottom="5"
      style="position: relative; z-index: 99"
      :target="() => containerRef.value"
    >
      <div ref="navigatorContainer"></div>
    </a-affix>
  </div>
</template>
