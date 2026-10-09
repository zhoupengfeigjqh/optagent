import type { ColumnsType } from '#/components/z-table/table.data';

import dayjs from 'dayjs';

// ========== 状态颜色映射 ==========
export const ganttStatusColor: Record<string, string> = {
  completed: '#52c41a',
  inprogress: '#1890ff',
  planned: '#bfbfbf',
  warning: '#fa8c16',
  delayed: '#ff4d4f',
  urgent: '#722ed1',
};

export const statusTextMap: Record<string, string> = {
  completed: '已完工',
  inprogress: '在执行',
  planned: '计划',
  warning: '预警',
  delayed: '延期',
  urgent: '紧急',
};

// ========== 顶部 KPI ==========
export interface KpiItem {
  afterValue: string;
  beforeValue: string;
  key: string;
  label: string;
  text: string;
  trend: '' | 'down' | 'up';
  unit: string;
}

export const kpiItems: KpiItem[] = [
  {
    key: 'utilization',
    label: '排产订单数',
    beforeValue: '0',
    afterValue: '6',
    unit: '单',
    text: '↑ 较插单前新增 +6 单',
    trend: 'up',
  },
  {
    key: 'delivery',
    label: '调整工单数',
    beforeValue: '0',
    afterValue: '6',
    unit: '单',
    text: '↑ 涉及调整 +12 单',
    trend: 'up',
  },
  {
    key: 'delayed',
    label: '设备利用率',
    beforeValue: '82.4',
    afterValue: '87.6',
    unit: '%',
    text: '↑ 利用率提升 +5.2%',
    trend: 'up',
  },
  {
    key: 'affected',
    label: '按时交付率',
    beforeValue: '90.1',
    afterValue: '93.5',
    unit: '%',
    text: '↑ 达成率提升 +5.5%',
    trend: 'up',
  },
  {
    key: 'urgent',
    label: '新增延期风险',
    beforeValue: '0',
    afterValue: '2',
    unit: '单',
    text: '↓ 需关注',
    trend: 'down',
  },
];

// ========== 甘特图数据（排产前后，设备/工序为行） ==========
/** 甘特图色块（工序任务条） */
interface GanttBlock {
  /** 受影响工序（计划调整）：渲染橙色描边 */
  affected?: boolean;
  endDay: number;
  id: string;
  label: string;
  /** 完成进度 0~100，渲染为色块内的局部进度填充 */
  progress: number;
  startDay: number;
  status: string;
  workOrder: string;
}
/** 甘特图行（设备 + 工序任务），行级状态/进度用于左侧表格展示 */
interface GanttRow {
  blocks: GanttBlock[];
  id: string;
  name: string;
  progress: number;
  status: string;
}

/** 甘特图数据点（传给 Highcharts 的单条任务） */
export interface GanttPoint {
  borderColor?: string;
  borderWidth?: number;
  color: string;
  end: number;
  id: string;
  name: string;
  partialFill: { amount: number };
  progress: number;
  start: number;
  status: string;
  workOrder: string;
  y: number;
}

// 使用本地时区零点作为基准，保证周末 plotBands 与坐标轴日期刻度对齐
const BASE_TIME = new Date(2026, 7, 1).getTime(); // 2026-08-01
const DAY = 24 * 3600 * 1000;

/**
 * 将行结构展开为 Highcharts 甘特图数据点：
 * - color：按任务状态取色（紫色为紧急插单）
 * - partialFill：按进度在色块内渲染局部填充（对应原型的 block-progress 内条）
 * - borderColor/borderWidth：受影响工序（计划调整）渲染橙色描边（对应 block-affected）
 * - status/workOrder/progress：自定义字段透传，tooltip 中展示
 */
function toGanttData(rows: GanttRow[]): GanttPoint[] {
  const data: GanttPoint[] = [];
  rows.forEach((row, y) => {
    row.blocks.forEach((b) => {
      data.push({
        borderColor: b.affected ? '#ff4d4f' : undefined,
        borderWidth: b.affected ? 2 : undefined,
        color: ganttStatusColor[b.status] ?? '#bfbfbf',
        end: BASE_TIME + b.endDay * DAY,
        id: b.id,
        name: b.label,
        partialFill: { amount: b.progress / 100 },
        progress: b.progress,
        start: BASE_TIME + b.startDay * DAY,
        status: b.status,
        workOrder: b.workOrder,
        y,
      });
    });
  });
  return data;
}

// 排产前（原始排产）
export const beforeGanttRows: GanttRow[] = [
  {
    id: 'EQ-001',
    name: 'CNC加工中心-01',
    status: 'inprogress',
    progress: 65,
    blocks: [
      {
        id: 'B001',
        label: 'WO-0801 主轴A',
        startDay: 0,
        endDay: 3,
        progress: 100,
        status: 'completed',
        workOrder: 'WO-2026-0801',
      },
      {
        id: 'B002',
        label: 'WO-0804 齿轮B',
        startDay: 3,
        endDay: 7,
        progress: 60,
        status: 'inprogress',
        workOrder: 'WO-2026-0804',
      },
      {
        id: 'B003',
        label: 'WO-0808 壳体C',
        startDay: 7,
        endDay: 12,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0808',
      },
    ],
  },
  {
    id: 'EQ-002',
    name: 'CNC加工中心-02',
    status: 'completed',
    progress: 100,
    blocks: [
      {
        id: 'B004',
        label: 'WO-0802 轴承A',
        startDay: 0,
        endDay: 4,
        progress: 100,
        status: 'completed',
        workOrder: 'WO-2026-0802',
      },
      {
        id: 'B005',
        label: 'WO-0809 轴承座',
        startDay: 4,
        endDay: 10,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0809',
      },
    ],
  },
  {
    id: 'EQ-003',
    name: '磨床-001',
    status: 'inprogress',
    progress: 45,
    blocks: [
      {
        id: 'B006',
        label: 'WO-0803 齿轮B',
        startDay: 1,
        endDay: 6,
        progress: 45,
        status: 'inprogress',
        workOrder: 'WO-2026-0803',
      },
      {
        id: 'B007',
        label: 'WO-0810 模具D',
        startDay: 6,
        endDay: 11,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0810',
      },
    ],
  },
  {
    id: 'EQ-004',
    name: '激光切割机-01',
    status: 'completed',
    progress: 100,
    blocks: [
      {
        id: 'B008',
        label: 'WO-0805 板材D',
        startDay: 1,
        endDay: 8,
        progress: 100,
        status: 'completed',
        workOrder: 'WO-2026-0805',
      },
      {
        id: 'B009',
        label: 'WO-0811 壳体E',
        startDay: 8,
        endDay: 13,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0811',
      },
    ],
  },
  {
    id: 'EQ-005',
    name: '自动化线-01',
    status: 'inprogress',
    progress: 75,
    blocks: [
      {
        id: 'B010',
        label: 'WO-0806 连接件E',
        startDay: 4,
        endDay: 9,
        progress: 75,
        status: 'inprogress',
        workOrder: 'WO-2026-0806',
      },
      {
        id: 'B011',
        label: 'WO-0812 组件F',
        startDay: 9,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0812',
      },
    ],
  },
  {
    id: 'EQ-006',
    name: '热处理炉-01',
    status: 'planned',
    progress: 50,
    blocks: [
      {
        id: 'B012',
        label: 'WO-0807 齿轮B',
        startDay: 5,
        endDay: 11,
        progress: 50,
        status: 'inprogress',
        workOrder: 'WO-2026-0807',
      },
      {
        id: 'B013',
        label: 'WO-0813 轴承A',
        startDay: 11,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0813',
      },
    ],
  },
  {
    id: 'EQ-007',
    name: '激光切割机-02',
    status: 'warning',
    progress: 30,
    blocks: [
      {
        id: 'B014',
        label: 'WO-0814 端盖D',
        startDay: 2,
        endDay: 7,
        progress: 30,
        status: 'warning',
        workOrder: 'WO-2026-0814',
      },
      {
        id: 'B015',
        label: 'WO-0815 法兰E',
        startDay: 7,
        endDay: 12,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0815',
      },
    ],
  },
  {
    id: 'EQ-008',
    name: '装配线-01',
    status: 'inprogress',
    progress: 55,
    blocks: [
      {
        id: 'B016',
        label: 'WO-0816 组件F',
        startDay: 3,
        endDay: 9,
        progress: 55,
        status: 'inprogress',
        workOrder: 'WO-2026-0816',
      },
      {
        id: 'B017',
        label: 'WO-0817 产品G',
        startDay: 9,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0817',
      },
    ],
  },
];

// 排产后（插入紧急单）
export const afterGanttRows: GanttRow[] = [
  {
    id: 'EQ-001',
    name: 'CNC加工中心-01',
    status: 'inprogress',
    progress: 65,
    blocks: [
      {
        id: 'B101',
        label: 'WO-0801 主轴A111',
        startDay: 0,
        endDay: 3,
        progress: 90,
        status: 'completed',
        workOrder: 'WO-2026-0801',
      },
      {
        id: 'B102',
        label: 'URGENT-0812 齿轮',
        startDay: 3,
        endDay: 5,
        progress: 0,
        status: 'urgent',
        workOrder: 'URGENT-0812',
      },
      {
        id: 'B103',
        label: 'WO-0804 齿轮B',
        startDay: 5,
        endDay: 9,
        progress: 55,
        status: 'inprogress',
        workOrder: 'WO-2026-0804',
        affected: true,
      },
    ],
  },
  {
    id: 'EQ-002',
    name: 'CNC加工中心-02',
    status: 'inprogress',
    progress: 70,
    blocks: [
      {
        id: 'B104',
        label: 'WO-0802 轴承A',
        startDay: 0,
        endDay: 4,
        progress: 100,
        status: 'completed',
        workOrder: 'WO-2026-0802',
      },
      {
        id: 'B105',
        label: 'URGENT-0815 轴承',
        startDay: 4,
        endDay: 7,
        progress: 0,
        status: 'urgent',
        workOrder: 'URGENT-0815',
      },
      {
        id: 'B106',
        label: 'WO-0809 轴承座',
        startDay: 7,
        endDay: 11,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0809',
        affected: true,
      },
    ],
  },
  {
    id: 'EQ-003',
    name: '磨床-001',
    status: 'inprogress',
    progress: 45,
    blocks: [
      {
        id: 'B107',
        label: 'WO-0803 齿轮B',
        startDay: 1,
        endDay: 6,
        progress: 45,
        status: 'inprogress',
        workOrder: 'WO-2026-0803',
      },
      {
        id: 'B108',
        label: 'WO-0810 模具D',
        startDay: 6,
        endDay: 11,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0810',
      },
    ],
  },
  {
    id: 'EQ-004',
    name: '激光切割机-01',
    status: 'inprogress',
    progress: 100,
    blocks: [
      {
        id: 'B109',
        label: 'WO-0805 板材D',
        startDay: 1,
        endDay: 8,
        progress: 100,
        status: 'completed',
        workOrder: 'WO-2026-0805',
      },
      {
        id: 'B110',
        label: 'URGENT-0818 壳体',
        startDay: 8,
        endDay: 12,
        progress: 0,
        status: 'urgent',
        workOrder: 'URGENT-0818',
      },
      {
        id: 'B111',
        label: 'WO-0811 壳体E',
        startDay: 12,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0811',
        affected: true,
      },
    ],
  },
  {
    id: 'EQ-005',
    name: '自动化线-01',
    status: 'inprogress',
    progress: 75,
    blocks: [
      {
        id: 'B112',
        label: 'WO-0806 连接件E',
        startDay: 4,
        endDay: 9,
        progress: 75,
        status: 'inprogress',
        workOrder: 'WO-2026-0806',
      },
      {
        id: 'B113',
        label: 'WO-0812 组件F',
        startDay: 9,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0812',
      },
    ],
  },
  {
    id: 'EQ-006',
    name: '热处理炉-01',
    status: 'planned',
    progress: 50,
    blocks: [
      {
        id: 'B114',
        label: 'WO-0807 齿轮B',
        startDay: 5,
        endDay: 11,
        progress: 50,
        status: 'inprogress',
        workOrder: 'WO-2026-0807',
      },
      {
        id: 'B115',
        label: 'WO-0813 轴承A',
        startDay: 11,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0813',
      },
    ],
  },
  {
    id: 'EQ-007',
    name: '激光切割机-02',
    status: 'inprogress',
    progress: 30,
    blocks: [
      {
        id: 'B116',
        label: 'WO-0814 端盖D',
        startDay: 2,
        endDay: 7,
        progress: 30,
        status: 'warning',
        workOrder: 'WO-2026-0814',
      },
      {
        id: 'B117',
        label: 'URGENT-0820 法兰',
        startDay: 7,
        endDay: 9,
        progress: 0,
        status: 'urgent',
        workOrder: 'URGENT-0820',
      },
      {
        id: 'B118',
        label: 'WO-0815 法兰E',
        startDay: 9,
        endDay: 13,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0815',
        affected: true,
      },
    ],
  },
  {
    id: 'EQ-008',
    name: '装配线-01',
    status: 'inprogress',
    progress: 55,
    blocks: [
      {
        id: 'B119',
        label: 'WO-0816 组件F',
        startDay: 3,
        endDay: 9,
        progress: 55,
        status: 'inprogress',
        workOrder: 'WO-2026-0816',
      },
      {
        id: 'B120',
        label: 'WO-0817 产品G',
        startDay: 9,
        endDay: 14,
        progress: 0,
        status: 'planned',
        workOrder: 'WO-2026-0817',
      },
    ],
  },
];

export const beforeGanttData = toGanttData(beforeGanttRows);
export const afterGanttData = toGanttData(afterGanttRows);

// 甘特图左侧表格列（设备 + 任务）
export const ganttTableCols: ColumnsType[] = [
  { title: '设备', dataIndex: 'id' },
  { title: '任务', dataIndex: 'name' },
];

// 甘特图左侧表格列（排产前后对比：设备/工序、状态、进度）
export const ganttCompareCols: ColumnsType[] = [
  {
    title: '设备 / 工序',
    dataIndex: 'name',
    key: 'device',
    slot: 'device',
    width: 150,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    slot: 'status',
    width: 80,
  },
  {
    title: '进度',
    dataIndex: 'progress',
    key: 'progress',
    slot: 'progress',
    width: 90,
  },
];

/**
 * 计算时间范围内每个周末（周六 00:00 ~ 周一 00:00）的 plotBands，
 * 用于甘特图周末灰底高亮（对应原型的 .gantt-axis-cell.weekend）
 */
function buildWeekendPlotBands(minTs: number, maxTs: number) {
  const bands: { color: string; from: number; to: number }[] = [];
  const cursor = new Date(minTs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= maxTs) {
    // getDay() === 6 表示周六，一个周末覆盖周六 + 周日两天
    if (cursor.getDay() === 6) {
      const from = cursor.getTime();
      bands.push({ color: 'rgba(0, 0, 0, 0.035)', from, to: from + 2 * DAY });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return bands;
}

const WEEKDAY_TEXT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const day = 24 * 36e5;
const today = Math.floor(Date.now() / day) * day;
// 甘特图 Highcharts option 构建
export function buildGanttOption(data: GanttPoint[]) {
  const categories = [...new Set(data.map((d) => d.y))];
  // 取数据的时间范围，用于生成周末灰底 plotBands
  const times = data.flatMap((d) => [d.start, d.end]);
  const minTs = Math.min(...times);
  const maxTs = Math.max(...times);
  return {
    chart: {
      spacingTop: 10,
      spacingBottom: 10,
      spacingRight: 0,
      marginRight: 0,
      plotLeft: 0,
      plotBorderWidth: 0, // 隐藏图表边框
      scrollablePlotArea: {
        opacity: 0.5,
        minWidth: 1000,
        minHeight: 400,
        scrollPositionX: 0,
      },
    },
    boost: { useGPUTranslations: true, boostThreshold: 3000 },
    // 悬浮提示：展示工序任务 / 生产工单 / 计划时间 / 进度（对应原型 gantt-tooltip）
    tooltip: {
      enabled: true,
      useHTML: true,
      formatter: (ctx: any) => {
        // ZGantt 会把当前数据点挂到 ctx.point 上（兼容 this.point 写法）
        const p = ctx?.point ?? {};
        const status = p.status ?? p.options?.status ?? '';
        const bg = ganttStatusColor[status] ?? '#bfbfbf';
        return `
          <div style="min-width:180px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="background:${bg};color:#fff;font-size:11px;padding:0 6px;border-radius:9px;line-height:18px;">${statusTextMap[status] ?? status}</span>
              <span style="font-weight:600;">${p.name ?? ''}</span>
            </div>
            <div style="font-size:12px;color:#666;line-height:20px;">
              <div>工序任务：${p.id ?? ''}</div>
              <div>生产工单：${p.workOrder ?? ''}</div>
              <div>计划时间：${dayjs(p.start).format('MM-DD')} ~ ${dayjs(p.end).format('MM-DD')}</div>
              <div>进度：${p.progress ?? 0}%</div>
            </div>
          </div>`;
      },
    },
    plotOptions: {
      gantt: { turboThreshold: 0, animation: false, pointPadding: 0.1 },
      series: {
        dragDrop: { draggableX: false, draggableY: false },
      },
    },
    rangeSelector: { enabled: true },
    // 周末灰底高亮 + 日期轴按「几号 周几」展示（对应原型 days 轴）
    xAxis: {
      plotBands: buildWeekendPlotBands(minTs, maxTs),
      labels: {
        formatter(this: any) {
          const d = new Date(this.value as number);
          const day = String(d.getDate()).padStart(2, '0');
          return `${day} ${WEEKDAY_TEXT[d.getDay()]}`;
        },
      },
      // min: minTs - 1 * day,
      // max: maxTs + 1 * day,
    },
    // xAxis: [
    //   {
    //     currentDateIndicator: {
    //       color: '#2caffe',
    //       dashStyle: 'ShortDot',
    //       width: 2,
    //       label: {
    //         format: '',
    //       },
    //     },
    //     dateTimeLabelFormats: {
    //       day: '%e<br><span style="opacity: 0.5; font-size: 0.7em">%a</span>',
    //     },
    //     grid: {
    //       borderWidth: 0,
    //     },
    //     gridLineWidth: 1,
    //     min: today - 3 * day,
    //     max: today + 18 * day,
    //     custom: {
    //       today,
    //       weekendPlotBands: true,
    //     },
    //   },
    // ],
    yAxis: { type: 'category', categories, min: 0, max: categories.length - 1 },
    // {#if point.completed}{(multiply ' +'point.completed.amount 100):.0f}%{/if}
    series: [
      {
        turboThreshold: 0,
        name: '生产任务',
        dataLabels: {
          enabled: true,
          format: '{point.name}-{point.progress}%',
          style: {
            fontWeight: 'normal',
            textOutline: 'none',
            color: '#fff',
          },
        },
        data: data.map((d) => ({
          id: d.id,
          name: d.name,
          start: d.start,
          end: d.end,
          y: d.y,
          color: d.color,
          partialFill: d.partialFill,
          borderColor: d.borderColor,
          borderWidth: d.borderWidth,
          status: d.status,
          workOrder: d.workOrder,
          progress: d.progress,
        })),
      },
    ],
  };
}

// ========== 影响分析统计 ==========
export interface ImpactStats {
  name: string;
  text: string;
  unit: string;
  value: number;
}

export const impactStats: ImpactStats[] = [
  {
    name: '影响工单数量',
    value: 12,
    unit: '单',
    text: '排产计划被挤占，需重新排程',
  },
  {
    name: '影响订单数量',
    value: 5,
    unit: '单',
    text: '交付计划受牵连，需顺延排产',
  },
  {
    name: '工序累计顺延量',
    value: 11,
    unit: '天',
    text: '延期 / 调整工单合计推迟 11 天',
  },
  {
    name: '最长交期影响',
    value: 4,
    unit: '天',
    text: '壳体E型（WO-2026-0811）延后 4 天',
  },
  {
    name: '工单延期率',
    value: 25,
    unit: '%',
    text: '延期 2 单 / 受影响 8 单',
  },
];

// ========== 影响分析表 ==========
export interface ImpactEntity {
  id: string;
  impactDesc: string;
  impactType: string;
  newEquipment: string;
  newTime: string;
  originalEquipment: string;
  originalTime: string;
  product: string;
}

export const impactCols: ColumnsType[] = [
  { title: '工单号', dataIndex: 'id', width: 150, fixed: 'left' },
  { title: '产品', dataIndex: 'product', width: 120 },
  { title: '原排产时间', dataIndex: 'originalTime', width: 140 },
  { title: '新排产时间', dataIndex: 'newTime', width: 140 },
  { title: '原设备', dataIndex: 'originalEquipment', width: 140 },
  { title: '新设备', dataIndex: 'newEquipment', width: 140 },
  {
    title: '影响类型',
    dataIndex: 'impactType',
    width: 110,
    slot: 'impactType',
  },
  { title: '影响说明', dataIndex: 'impactDesc', width: 220, ellipsis: true },
];

export const impactMock: ImpactEntity[] = [
  {
    id: 'WO-2026-0804',
    product: '齿轮B型',
    originalTime: '08-04 ~ 08-07',
    newTime: '08-06 ~ 08-09',
    originalEquipment: 'CNC加工中心-01',
    newEquipment: 'CNC加工中心-01',
    impactType: '延期',
    impactDesc: '延后2天，因紧急单插队',
  },
  {
    id: 'WO-2026-0809',
    product: '轴承座E型',
    originalTime: '08-05 ~ 08-10',
    newTime: '08-08 ~ 08-11',
    originalEquipment: 'CNC加工中心-02',
    newEquipment: 'CNC加工中心-02',
    impactType: '调整时间',
    impactDesc: '顺延3天，避让紧急单',
  },
  {
    id: 'WO-2026-0811',
    product: '壳体E型',
    originalTime: '08-08 ~ 08-13',
    newTime: '08-12 ~ 08-14',
    originalEquipment: '激光切割机-01',
    newEquipment: '激光切割机-01',
    impactType: '延期',
    impactDesc: '延后4天，受紧急单挤压',
  },
  {
    id: 'WO-2026-0815',
    product: '法兰盘E型',
    originalTime: '08-07 ~ 08-12',
    newTime: '08-09 ~ 08-13',
    originalEquipment: '激光切割机-02',
    newEquipment: '激光切割机-02',
    impactType: '调整时间',
    impactDesc: '顺延2天，紧急单插队',
  },
  {
    id: 'WO-2026-0810',
    product: '模具D型',
    originalTime: '08-07 ~ 08-11',
    newTime: '08-07 ~ 08-11',
    originalEquipment: '磨床-001',
    newEquipment: '磨床-001',
    impactType: '无影响',
    impactDesc: '设备负荷允许，无需调整',
  },
  {
    id: 'WO-2026-0812',
    product: '组件F型',
    originalTime: '08-09 ~ 08-14',
    newTime: '08-09 ~ 08-14',
    originalEquipment: '自动化线-01',
    newEquipment: '自动化线-01',
    impactType: '提前',
    impactDesc: '提前1天完成，因前置工序加快',
  },
  {
    id: 'WO-2026-0813',
    product: '轴承A型',
    originalTime: '08-11 ~ 08-14',
    newTime: '08-11 ~ 08-14',
    originalEquipment: '热处理炉-01',
    newEquipment: '热处理炉-01',
    impactType: '调整设备',
    impactDesc: '调整至备用热处理炉-02',
  },
  {
    id: 'WO-2026-0817',
    product: '产品G型',
    originalTime: '08-09 ~ 08-14',
    newTime: '08-09 ~ 08-14',
    originalEquipment: '装配线-01',
    newEquipment: '装配线-01',
    impactType: '无影响',
    impactDesc: '装配阶段不受前置调整影响',
  },
];

/** 影响类型标签颜色 */
export const impactTypeColor: Record<string, string> = {
  延期: 'red',
  调整时间: 'orange',
  调整设备: 'blue',
  提前: 'green',
  无影响: 'default',
};
