<script setup lang="ts">
import type { ColumnsType } from '#/components/z-table/table.data';

import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import ZGantt from '#/components/z-gantt/index.vue';
import { isTruth } from '#/utils/is';

const props = defineProps<{
  cols: any[];
  ganttData: any[];
  ganttOption: any;
  isFixedBtn?: boolean;
  navPosition?: 'bottom' | 'top';
  rowKey?: string;
  tableData: any[];
}>();

const emit = defineEmits(['update:cols']);

const navPaddingTop = 160;
const normalPaddingTop = props.ganttOption.rangeSelector.enabled ? 90 : 55;
const ganttRef = ref<any>(null);
const tableSectionRef = ref<any>(null);
const containerRef = ref<any>(null);
const showGuideLine = ref(false);
const guideLinePosition = ref(200);
const tableWidth = ref('200px');
const tempWidth = ref(0);
const handlerTop = ref(0);
const openTour = ref(false);
const tourRef = ref();
let isClick = true;

const cols = computed<ColumnsType[]>({
  get: () => {
    const resizableCols = props.cols.map((col) => ({
      ...col,
      resizable: isTruth(col.resizable) ? col.resizable : true,
      minWidth: isTruth(col.minWidth) ? col.minWidth : 80,
      maxWidth: isTruth(col.maxWidth) ? col.maxWidth : 600,
      width: isTruth(col.width) ? col.width : 100,
      ellipsis: isTruth(col.ellipsis) ? col.ellipsis : true,
    }));
    return resizableCols;
  },
  set: (val) => emit('update:cols', val),
});
/**
 * 更新甘特图数据
 * @param option
 */
const updateGantt = (option: any) => {
  if (ganttRef.value) ganttRef.value.updateGantt(option);
};
/**
 * 将可解析的时间字符串统一转为时间戳，避免 Highcharts 无法解析
 */
const toTimestamp = (value: any): any => {
  if (typeof value === 'string') {
    const ts = Date.parse(value);
    return Number.isNaN(ts) ? value : ts;
  }
  return value;
};
/**
 * 将外部甘特图数据规范化为 Highcharts Gantt 所需字段：
 * - startTime/endTime（接口常用字段）兼容转成 start/end
 * - 时间值统一为时间戳
 * - 缺失 y（行坐标）时按数据顺序补齐，保证每个点都能定位到行
 */
const normalizeGanttData = (list: any[] = []): any[] => {
  if (!Array.isArray(list)) return [];
  return list.map((item: any, index: number) => {
    const hasStart = item.start !== undefined || item.x !== undefined;
    const hasEnd = item.end !== undefined || item.x2 !== undefined;
    return {
      ...item,
      start: toTimestamp(hasStart ? (item.start ?? item.x) : item.startTime),
      end: toTimestamp(hasEnd ? (item.end ?? item.x2) : item.endTime),
      y: item.y === undefined ? index : item.y,
    };
  });
};
/** 规范化后的甘特图数据（传给 z-gantt，同时供 option 组装与更新使用） */
const ganttChartData = computed<any[]>(() =>
  normalizeGanttData(props.ganttData),
);
/**
 * 监听甘特图数据变化，变化后同步更新甘特图数据
 */
watch(
  () => props.ganttData,
  () => {
    if (!ganttRef.value) return;
    nextTick(() => {
      // 携带最新的数据与 y 轴分类/范围，避免行数变化时出现截断或错位
      updateGantt(ganttOpt.value);
    });
  },
  { deep: true },
);
/**
 * 共享运行时上下文：由本组件创建并透传给 z-gantt，
 * z-gantt 会把图表实例、鼠标坐标、当前数据点注入其中，业务侧无需自行声明
 */
const ganttCtx: Record<string, any> = {};

/** 解析 ganttOption：支持工厂函数 (ctx) => option 与普通对象两种形式 */
const resolveGanttOption = (option: any): any =>
  typeof option === 'function' ? option(ganttCtx) : option || {};

/**
 * 组装传给 z-gantt 的 option：
 * - 分类名由左侧表格展示：关闭 y 轴的标签与标题渲染，仅保留 grid 用于绘制绘图区
 *   左侧的纵向边界线，并把 grid 列宽压到 1px，不留下空白单元格列
 *   （替代原先 marginLeft:1 把 y 轴挤出可视区的做法：那样分类文本仍会绘制到绘图区
 *   之外，数据更新重绘时 Tick label 带位移动画，表现为名称闪现后消失）
 * - 保证至少存在一个 series 且携带最新甘特图数据，使首次初始化即可渲染
 * - y 轴未配置分类时，按甘特图数据顺序自动生成分类与范围
 */
const ganttOpt = computed(() => {
  const data = ganttChartData.value;
  // 解析业务配置（函数形式会把本组件的共享上下文传入，回调内可直接用 ctx）
  const rawOption = resolveGanttOption(props.ganttOption);
  const rawSeries = Array.isArray(rawOption?.series) ? rawOption.series : [];
  const baseSeries =
    rawSeries.length > 0 ? rawSeries[0] : { name: '甘特图', turboThreshold: 0 };

  const rawYAxis = rawOption?.yAxis || {};
  const needAutoAxis =
    !Array.isArray(rawYAxis.categories) || rawYAxis.categories.length === 0;
  // y 轴基础配置：未配置分类时按甘特图数据顺序自动生成分类与范围
  const baseYAxis = needAutoAxis
    ? {
        ...rawYAxis,
        categories: data.map(
          (d: any, index: number) => d?.name ?? `任务${index + 1}`,
        ),
        min: 0,
        max: Math.max(data.length - 1, rawYAxis.min ?? 0),
      }
    : { ...rawYAxis };

  return {
    ...rawOption,
    yAxis: {
      ...baseYAxis,
      // 保留 Gantt 的 grid：其边界线由 yAxis 的 lineWidth 绘制（renderBorder），
      // borderColor 会覆盖 lineColor/tickColor，用于给出绘图区左侧的纵向轴线
      grid: {
        ...baseYAxis.grid,
        enabled: true,
        borderColor: baseYAxis.grid?.borderColor ?? '#e0e0e0',
      },
      // 不渲染分类文本：左侧表格已展示分类名，且这是数据更新时名称闪现动画的来源；
      // grid 列宽 = 2 * distance + 标签宽度，取 0.5 使列宽为 1px：既不留空白列，
      // 又让 grid 边界线与 y 轴线重合，只呈现一条纵向轴线
      labels: { ...baseYAxis.labels, enabled: false, distance: 0.5 },
      // Highcharts 默认 y 轴标题为 'Values'，未显式配置时关闭，避免占位与文本绘制
      title: baseYAxis.title ?? { text: null },
      // 刻度线不绘制（grid 模式下列宽由 labels.distance 决定，与 tickLength 无关）
      tickLength: 0,
      tickWidth: 0,
      // grid 的边界线依赖 lineWidth 绘制，需大于 0
      lineWidth: baseYAxis.lineWidth ?? 1,
    },
    series: [{ ...baseSeries, data }, ...rawSeries.slice(1)],
  };
});
/**
 * 鼠标按下句柄
 * @param e
 */
const handleMouseDown = (e: MouseEvent) => {
  e.preventDefault();
  showGuideLine.value = true;
  if (tableSectionRef.value) {
    tempWidth.value = tableSectionRef.value.offsetWidth;
  }

  if (containerRef.value) {
    const containerRect = containerRef.value.getBoundingClientRect();
    guideLinePosition.value = e.clientX - containerRect.left;
  }

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);
};
/**
 * 鼠标移动句柄
 * @param e
 */
const handleMouseMove = (e: MouseEvent) => {
  e.preventDefault();
  isClick = false;
  if (!containerRef.value) return;

  const containerRect = containerRef.value.getBoundingClientRect();
  const minWidth = 100;
  const maxWidth = containerRect.width * 0.6;

  let newWidth = e.clientX - containerRect.left;
  newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

  guideLinePosition.value = newWidth;
  tempWidth.value = newWidth;
};
/**
 * 鼠标抬起句柄
 */
const handleMouseUp = () => {
  showGuideLine.value = false;
  tableWidth.value = `${tempWidth.value}px`;
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  const timer = setTimeout(() => {
    isClick = true;
    clearTimeout(timer);
  }, 1000);
};
/**
 * 表格调整列宽
 * @param w
 * @param col
 */
function handleResizeColumn(w: any, col: any) {
  cols.value = cols.value.map((item) =>
    item.dataIndex === col.dataIndex ? { ...item, width: w } : item,
  );
}
/**
 * 全局滚动时，带动拖拽句柄一起移动，方便用户在任何位置操作句柄
 */
const handleScroll = () => {
  const base = props.navPosition === 'top' ? navPaddingTop : normalPaddingTop;
  handlerTop.value = base + window.scrollY;
};

const handleVisibleTable = () => {
  if (isClick) {
    tableWidth.value = tableWidth.value === '0px' ? '100px' : '0px';
    guideLinePosition.value = tableWidth.value === '0px' ? 0 : 100;
  }
};

onMounted(() => {
  if (tableSectionRef.value) {
    tableWidth.value = `${tableSectionRef.value.offsetWidth}px`;
  }
  handlerTop.value =
    props.navPosition === 'top' ? navPaddingTop : normalPaddingTop;

  const timer = setTimeout(() => {
    const hasDragedHandler = localStorage.getItem('hasDragedHandler');
    if (!hasDragedHandler) {
      localStorage.setItem('hasDragedHandler', '1');
      openTour.value = true;
    }
    clearTimeout(timer);
  }, 1500);
  if (!props?.isFixedBtn) window.addEventListener('scroll', handleScroll);
});
/**
 * 销毁绑定的事件
 */
onUnmounted(() => {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseup', handleMouseUp);
  if (!props?.isFixedBtn) window.removeEventListener('scroll', handleScroll);
});

const steps = [
  {
    title: '拖拽句柄',
    description: '拖拽该按钮可调节表格与甘特图的宽度',
    target: () => tourRef.value && tourRef.value.$el,
  },
];

defineExpose({
  updateGantt,
});
</script>

<template>
  <div>
    <main
      class="of-hidden relative flex"
      id="gantt-table-container"
      ref="containerRef"
    >
      <a-button
        ref="tourRef"
        class="drag-handler"
        @click="handleVisibleTable"
        @mousedown="handleMouseDown"
        :style="{
          left: `${guideLinePosition}px`,
          top: `${handlerTop}px`,
        }"
      />

      <div
        v-if="showGuideLine"
        class="guide-line"
        :style="{ left: `${guideLinePosition}px` }"
      ></div>

      <section
        ref="tableSectionRef"
        class="table-section"
        :style="{
          paddingTop:
            props.navPosition === 'top'
              ? `${navPaddingTop}px`
              : `${normalPaddingTop}px`,
          width: tableWidth,
          minWidth: '100px',
          maxWidth: '60%',
        }"
        v-show="tableWidth !== '0px'"
      >
        <a-table
          :row-key="props.rowKey || 'id'"
          :columns="cols"
          :data-source="props.tableData"
          :pagination="false"
          @resize-column="handleResizeColumn"
          size="small"
          bordered
        >
          <template #bodyCell="{ column, record, text }">
            <template v-if="column.slot">
              <slot
                :name="column.slot"
                :record="record"
                :text="text"
                :column="column"
              ></slot>
            </template>
            <template v-else>
              {{ text }}
            </template>
          </template>
        </a-table>
      </section>

      <div class="min-w-0 flex-1">
        <ZGantt
          :option="ganttOpt"
          :data="ganttChartData"
          :context="ganttCtx"
          ref="ganttRef"
          :nav-position="props.navPosition"
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

:deep(
  .ant-table-wrapper
    .ant-table-container
    table
    > thead
    > tr:first-child
    > *:last-child
) {
  border-start-end-radius: 0;
}
</style>
