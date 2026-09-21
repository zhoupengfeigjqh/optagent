<script setup lang="ts">
import { getCurrentInstance, onMounted, ref, watch } from 'vue';
import { useThrottleFn } from '@vueuse/core';

import Highcharts from './static/js/gantt.js';
import { getPresetOptions } from '#/components/z-gantt/static/config/presetConfig.js';

const props = defineProps<{
  presetOptions?: ReturnType<typeof getPresetOptions> | Record<string, any>;
  /**
   * 甘特图配置：支持两种形式
   * - 工厂函数：(ctx) => option，ctx 为组件创建的共享运行时上下文（推荐）
   * - 普通对象：与旧用法一致
   */
  option?: Record<string, any> | ((ctx: Record<string, any>) => any);
  /** 外部共享运行时上下文（如 z-gantt-table 需自行解析 option 时创建），不传则组件内部创建 */
  context?: Record<string, any>;
  data?: any[];
  navPosition?: 'top' | 'bottom';
}>();

const emit = defineEmits<{
  (e: 'handlePointClick', event: any): void;
  (e: 'handlePointClickMouseY', event: any): void;
  (e: 'handlePointDblclick', event: any): void;
  (e: 'handlePointDragStart', event: any): void;
  (e: 'handlePointDraging', event: any): void;
  (e: 'handlePointDragEnd', event: any): void;
  (
    e: 'handleViewChange',
    event: { xMin: number; xMax: number; yMin: number; yMax: number },
  ): void;
}>();

const myChart = ref<any>(null);

let chartInstance: any = null;

const navigatorContainer = ref<any>(null);

let navInstance: any = null;

let isSyncing = false;

const emitViewChange = () => {
  if (chartInstance && !isSyncing) {
    const xAxis = chartInstance.xAxis[0];
    const yAxis = chartInstance.yAxis[0];
    emit('handleViewChange', {
      xMin: xAxis.min,
      xMax: xAxis.max,
      yMin: yAxis.min,
      yMax: yAxis.max,
    });
  }
};

/**
 * 处理 tooltip.formatter 并注入共享运行时上下文：
 * - 若 option 携带共享上下文（__ganttCtx，由 ganttOption 工厂挂载的 ctx 引用），
 *   在每次 formatter 被 Highcharts 调用前，将当前 tooltip 上下文写入该对象
 *   （ctx.point / ctx.tooltip），使 data.ts 内各配置项回调可直接使用 ctx.point 取当前数据点，
 *   无需依赖 this 绑定或首参透传约定；
 * - 同时用 apply 把解析出的上下文作为 this 与首个参数传给原 formatter，
 *   兼容既有普通函数（this.point）与箭头函数（首参.point）的写法。
 */
const normalizeTooltipFormatter = (option: any): any => {
  if (!option) return option;
  // 取出 ganttOption 工厂挂载的共享上下文引用，不把内部字段透传给 Highcharts
  const { __ganttCtx: ganttCtx, ...cleanOption } = option;
  if (typeof option?.tooltip?.formatter !== 'function') {
    return ganttCtx ? cleanOption : option;
  }
  const { formatter, ...restTooltip } = option.tooltip;
  return {
    ...cleanOption,
    tooltip: {
      ...restTooltip,
      style: {
        ...restTooltip.style,
        zIndex: 21,
      },
      formatter: function (this: any, ...args: any[]) {
        // Highcharts 传入的上下文可能在 this 上，也可能在首个参数上（不同版本实现有差异）
        const first = args[0];
        const isCtx = (v: any) => v && (v.point || v.label || v.series);
        const context = isCtx(this)
          ? this
          : isCtx(first)
            ? first
            : (this ?? first ?? {});
        // 注入共享上下文：data.ts 中 ganttOption(ctx) 内任意回调可直接使用 ctx.point
        if (ganttCtx && typeof ganttCtx === 'object') {
          ganttCtx.point = context?.point ?? context;
          ganttCtx.tooltip = context;
        }
        // apply 绑定 this + 首参透传上下文，普通函数 / 箭头函数写法均可使用
        return formatter.apply(context, [context, ...args]);
      },
    },
  };
};

const instance = getCurrentInstance();

/**
 * 共享运行时上下文：
 * - option 为工厂函数时作为入参传入（业务侧无需自行声明 ctx）
 * - 组件会把图表实例、鼠标坐标、当前数据点注入其中，
 *   data.ts 内各回调（tooltip.formatter / positioner / dataLabels.formatter）直接读 ctx 即可
 */
const runtimeCtx: Record<string, any> = props.context ?? {};
runtimeCtx.instance = runtimeCtx.instance ?? instance;

/** 解析 option：支持工厂函数 (ctx) => option 与普通对象两种形式 */
const resolveOption = (option: any): any =>
  typeof option === 'function' ? option(runtimeCtx) : option || {};

/**
 * 监听容器鼠标移动，把图表坐标写入共享上下文（节流 100ms）
 * @description Highcharts 的 Pointer 实例上没有 chartX（normalize 只把坐标写到事件对象上），
 * 只能自行缓存，供 tooltip.positioner / formatter 换算鼠标所在时间
 */
const bindMouseTracker = (chart: any, ganttCtx: Record<string, any>) => {
  const container = chart?.container;
  if (!container || container._ganttMouseBound) return;
  container._ganttMouseBound = true;
  const updateMousePosition = useThrottleFn((event: MouseEvent) => {
    const rect = container.getBoundingClientRect();
    // 启用 scrollablePlotArea 时需补上内部容器的横向滚动偏移
    const scrollLeft = chart?.scrollingContainer?.scrollLeft ?? 0;
    ganttCtx.mouseX = event.clientX - rect.left + scrollLeft;
    ganttCtx.mouseY = event.clientY - rect.top;
  }, 100);
  container.addEventListener('mousemove', (event: MouseEvent) =>
    updateMousePosition(event),
  );
  container.addEventListener('mouseleave', () => {
    ganttCtx.mouseX = undefined;
    ganttCtx.mouseY = undefined;
  });
};

/**
 * 注入共享运行时上下文：
 * - 图表实例、鼠标坐标由组件统一写入 ctx（不再需要业务侧写 chart.events.load）
 * - dataLabels.formatter 调用前把当前数据点写入 ctx.point，
 *   使 data.ts 内可直接用形参/闭包 ctx 取 point，无需读 this
 */
const withRuntimeCtx = (option: any): any => {
  const { __ganttCtx, ...restOption } = option || {};
  const ganttCtx = __ganttCtx ?? runtimeCtx;
  const userLoad = restOption?.chart?.events?.load;
  const dataLabels = restOption?.plotOptions?.gantt?.dataLabels;
  const userLabelFormatter = dataLabels?.formatter;
  return {
    ...restOption,
    __ganttCtx: ganttCtx,
    chart: {
      ...restOption?.chart,
      events: {
        ...restOption?.chart?.events,
        load() {
          const chart: any = this;
          ganttCtx.chart = chart;
          bindMouseTracker(chart, ganttCtx);
          // 兼容业务侧自定义的 load 钩子
          if (typeof userLoad === 'function') userLoad.call(chart);
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
                  // 把当前数据点写入共享上下文，data.ts 直接用形参 ctx 取 point
                  ganttCtx.point = this?.point ?? ganttCtx.point;
                  return userLabelFormatter.call(this, ganttCtx, ...args);
                },
              },
            },
          },
        }
      : {}),
  };
};

const initGantt = (option: any) => {
  if (myChart.value && option) {
    // 解析（支持 (ctx) => option 工厂函数）并注入共享运行时上下文
    const ganttOpt = resolveOption(option);
    chartInstance = Highcharts.ganttChart(
      myChart.value as HTMLElement,
      normalizeTooltipFormatter(withRuntimeCtx(ganttOpt)),
    );

    Highcharts.addEvent(chartInstance.xAxis[0], 'afterSetExtremes', () => {
      emitViewChange();
    });

    Highcharts.addEvent(chartInstance.yAxis[0], 'afterSetExtremes', () => {
      emitViewChange();
    });

    if (props.navPosition && navigatorContainer.value) {
      // 获取主图表的 Y 轴配置，确保导航器与之同步
      const mainYAxis = ganttOpt.yAxis || {};

      // 构建导航器概览数据（确保颜色等属性被正确保留）
      const overviewData = buildOverviewData(ganttOpt.series[0].data);

      navInstance = Highcharts.navigator(navigatorContainer.value, {
        liveRedraw: true,
        // 同步主图表的 Y 轴配置，特别是 categories
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
      });
      navInstance.bind(chartInstance);

      if (navInstance.navigator && navInstance.navigator.chart) {
        Highcharts.addEvent(
          navInstance.navigator.chart.xAxis[0],
          'afterSetExtremes',
          () => {
            emitViewChange();
          },
        );

        Highcharts.addEvent(
          navInstance.navigator.chart.yAxis[0],
          'afterSetExtremes',
          () => {
            emitViewChange();
          },
        );
      }

      // 保存导航器的初始位置到 navigatorOptions，这样 render() 会优先使用这个值
      if (navInstance && navInstance.navigator) {
        if (!navInstance.navigator.navigatorOptions) {
          navInstance.navigator.navigatorOptions = {};
        }
        navInstance.navigator.navigatorOptions.top = navInstance.navigator.top;
        navInstance.navigator.navigatorOptions.left =
          navInstance.navigator.left;
      }

      // 同步导航器的 Y 轴范围与主图表一致
      syncNavigatorYAxis();
    }
  }
};
/**
 * 进度条点击事件
 */
const handlePointClick = (event: any) => {
  emit('handlePointClick', event);
};
/**
 * 进度条右键事件
 * @param event
 */
const handlePointClickMouseY = (event: any) => {
  emit('handlePointClickMouseY', event);
};
/**
 * 进度条双击事件
 */
const handlePointDblclick = (event: any) => {
  emit('handlePointDblclick', event);
};
/**
 * 拖拽进度条开始事件
 */
const handlePointDragStart = (event: any) => {
  emit('handlePointDragStart', event);
};
/**
 * 拖拽中事件
 */
const handlePointDraging = (event: any) => {
  emit('handlePointDraging', event);
};
/**
 * 拖拽结束事件
 */
const handlePointDragEnd = (event: any) => {
  emit('handlePointDragEnd', event);
};
/**
 * 设置甘特图预设
 */
const setPresetOptions = () => {
  const instance = getCurrentInstance();
  const resolvedPresetOptions =
    props.presetOptions ?? getPresetOptions(instance?.exposed);

  Highcharts.setOptions(resolvedPresetOptions);
};
onMounted(() => {
  setPresetOptions();
  initGantt(props.option);
});
/**
 * 构建导航器概览数据
 * @param seriesData 甘特图数据
 */
const buildOverviewData = (seriesData: any[]) => {
  return seriesData
    .map((item: any) => ({
      x: item.x || item.start,
      x2: item.x2 || item.end,
      y: item.y !== undefined ? item.y : 0,
      // 用于 categories 映射
      name: item.name,
      color: item.color,
      // 其他可能影响渲染的属性
      partialFill: item.partialFill,
      accessibility: item.accessibility,
    }))
    .filter((item: any) => item.x && item.x2);
};

/**
 * 同步导航器可视范围带
 * @param min 最小时间
 * @param max 最大时间
 */
const syncNavBand = (min: number, max: number) => {
  if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
    navInstance.navigator.chart.xAxis[0]?.setExtremes(min, max, false);
  }
};

/**
 * 同步导航器的 Y 轴范围与主图表一致
 */
const syncNavigatorYAxis = () => {
  if (
    chartInstance &&
    navInstance &&
    navInstance.navigator &&
    navInstance.navigator.chart
  ) {
    const mainYAxis = chartInstance.yAxis[0];
    const navYAxis = navInstance.navigator.chart.yAxis[0];

    if (mainYAxis && navYAxis) {
      // 同步 Y 轴范围
      navYAxis.setExtremes(mainYAxis.min, mainYAxis.max, false);
    }
  }
};

/**
 * 更新甘特图配置
 * @param option
 */
const updateGantt = (option: any) => {
  if (chartInstance && option) {
    // 解析（支持 (ctx) => option 工厂函数）并注入共享运行时上下文
    const ganttOpt = resolveOption(option);
    chartInstance.update(normalizeTooltipFormatter(withRuntimeCtx(ganttOpt)));
    if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
      const seriesData = ganttOpt.series?.[0]?.data || [];
      const overviewData = buildOverviewData(seriesData);
      // 传递完整的数据对象，保持甘特图缩略图的一致性
      navInstance.navigator.chart.series[0]?.setData(overviewData, false);
      // 确保颜色设置始终生效
      navInstance.navigator.chart.series[0]?.update(
        {
          colorByPoint: false,
        },
        false,
      );
      syncNavBand(chartInstance.xAxis[0].min, chartInstance.xAxis[0].max);
      // 同步 Y 轴范围
      syncNavigatorYAxis();
      navInstance.navigator.chart.redraw();
    }
  }
};

/**
 * 同步视图范围
 * @param xMin 时间轴最小时间
 * @param xMax 时间轴最大时间
 * @param yMin Y轴最小值
 * @param yMax Y轴最大值
 */
const syncView = (xMin: number, xMax: number, yMin?: number, yMax?: number) => {
  if (chartInstance) {
    isSyncing = true;
    chartInstance.xAxis[0].setExtremes(xMin, xMax, false);
    if (yMin !== undefined && yMax !== undefined) {
      chartInstance.yAxis[0].setExtremes(yMin, yMax, false);
    }
    chartInstance.redraw();
    if (navInstance && navInstance.navigator && navInstance.navigator.chart) {
      navInstance.navigator.chart.xAxis[0]?.setExtremes(xMin, xMax, false);
      if (yMin !== undefined && yMax !== undefined) {
        navInstance.navigator.chart.yAxis[0]?.setExtremes(yMin, yMax, false);
      }
      navInstance.navigator.chart.redraw();
    }
    isSyncing = false;
  }
};

watch(
  () => props.data,
  (newVal) => {
    if (myChart.value && newVal) {
      chartInstance.series[0]?.setData(JSON.parse(JSON.stringify(newVal)));
      // chartInstance.update({
      //   series: [
      //     {
      //       data: JSON.parse(JSON.stringify(newVal)),
      //     },
      //   ],
      // });
      // 如果开启了指定位置的导航器，同时更新导航器
      if (
        (props.navPosition,
        navInstance && navInstance.navigator && navInstance.navigator.chart)
      ) {
        const overviewData = buildOverviewData(newVal);
        // 传递完整的数据对象，保持甘特图缩略图的一致性
        navInstance.navigator.chart.series[0]?.setData(overviewData, false);
        syncNavBand(chartInstance.xAxis[0].min, chartInstance.xAxis[0].max);
        // 同步 Y 轴范围
        syncNavigatorYAxis();
        navInstance.navigator.chart.redraw();
      }
    }
  },
);
const containerRef = ref();

defineExpose({
  updateGantt,
  syncView,
  handlePointClick,
  handlePointClickMouseY,
  handlePointDblclick,
  handlePointDragStart,
  handlePointDraging,
  handlePointDragEnd,
});
</script>

<template>
  <div ref="containerRef">
    <a-affix
      :offset-top="100"
      v-if="props.navPosition === 'top'"
      style="position: relative; z-index: 99"
      :target="() => containerRef.value"
    >
      <!-- <a-affix :offset-top="100"  v-if="props.isTopNav" style="position: relative; z-index: 999;"> -->
      <div ref="navigatorContainer"></div>
    </a-affix>

    <div ref="myChart"></div>

    <a-affix
      :offset-bottom="5"
      v-if="props.navPosition === 'bottom'"
      style="position: relative; z-index: 99"
      :target="() => containerRef.value"
    >
      <div ref="navigatorContainer"></div>
    </a-affix>
  </div>
</template>
