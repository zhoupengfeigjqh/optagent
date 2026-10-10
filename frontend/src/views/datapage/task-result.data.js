
import dayjs from 'dayjs'
import {ref} from 'vue'
// 工单加工计划分页查询
export const overallPlanColumns = [
  {
    title: '排产任务ID',
    dataIndex: 'taskId',
    width: 150,
  },
  {
    title: '记录ID',
   dataIndex: 'recordId',
    width: 150,
  },
  {
    title: '物料ID',
   dataIndex: 'productId',
    width: 150,
  },
  {
    title: '物料名称',
   dataIndex: 'productName',
    width: 150,
  },
  {
    title: '物料优先级',
   dataIndex: 'materialPriority',
    width: 150,
  },
  {
    title: '是否加色',
   dataIndex: 'isColoring',
    width: 150,
    customRender: ({ text }) => ({ 1: '是', 0: '否' })[text] ?? '-',
  },
  {
    title: '是否加药',
   dataIndex: 'isDosing',
    width: 150,
    customRender: ({ text }) => ({ 1: '是', 0: '否' })[text] ?? '-',
  },
  {
    title: '特殊处理分组',
    dataIndex: 'specialProcessType',
    width: 150,
  },
  {
    title: '计划排产量（吨）',
   dataIndex: 'plannedProductionQuantity',
       width: 150,
  },
  {
    title: '实际生产数量（吨）',
   dataIndex: 'actualProductionQuantity',
       width: 150,
  },
  {
    title: '是否全部加工完成',
   dataIndex: 'isAllProcessed',
    width: 150,
    customRender: ({ text }) => ({ 1: '是', 0: '否' })[text] ?? '-',
  },
  {
    title: '期望开工时间',
   dataIndex: 'earliestStartTime',
       width: 150,
  },
  {
    title: '期望完工时间',
   dataIndex: 'latestCompletionTime',
       width: 150,
  },
  {
    title: '实际开工时间',
   dataIndex: 'actualStartTime',
          width: 150,
  },
  {
    title: '实际完工时间',
   dataIndex: 'actualEndTime',
       width: 150,
  },
  {
    title: '可用产线及优先级',
   dataIndex: 'availableLineAndPriority',
          width: 150,
  },
  {
    title: '创建时间',
   dataIndex: 'createTime',
          width: 150,
  },
];

//产线利用率分页查询
export const lineUsageRateColumns = [
  {
    title: '排产任务ID',
   dataIndex: 'taskId',
    width: 150,
  },
  {
    title: '产线编号',
   dataIndex: 'productionLineId',
    width: 150,
  },
  {
    title: '产线名称',
   dataIndex: 'productionLineName',
    width: 150,
  },
  {
    title: '混合机编号',
   dataIndex: 'mixerId',
    width: 150,
  },
  {
    title: '产线可用开始时间',
   dataIndex: 'lineAvailableStartTime',
    width: 150,
  },
  {
    title: '产线可用结束时间',
   dataIndex: 'lineAvailableEndTime',
    width: 150,
  },
  {
    title: '总可用时长（分钟）',
   dataIndex: 'totalAvailableTime',
    width: 150,
  },
  {
    title: '产线最早开始加工时间',
   dataIndex: 'lineEarliestStartTime',
    width: 150,
  },
  {
    title: '产线最晚结束加工时间',
   dataIndex: 'lineLatestEndTime',
    width: 150,
  },
  {
    title: '间隔时长（分钟）',
   dataIndex: 'lineIntervalTime',
    width: 150,
  },
  {
    title: '切换时间（分钟）',
   dataIndex: 'lineSwitchTime',
    width: 150,
  },
  {
    title: '切换产能损失比',
   dataIndex: 'lineSwitchCapacityLossRatio',
    width: 150,
  },
  {
    title: '实际加工时长（分钟）',
   dataIndex: 'lineActualProcessTime',
    width: 150,
  },
  {
    title: '利用率',
   dataIndex: 'lineUsageRate',
    width: 150,
  },
  {
    title: '产线电耗',
   dataIndex: 'lineElectricity',
    width: 150,
  },
  {
    title: '时间窗口违反数量',
   dataIndex: 'timeWindowViolationCount',
    width: 150,
  },
  {
    title: '理论环模违反数量',
   dataIndex: 'theoreticalRingModelViolationCount',
    width: 150,
  },
  {
    title: '蛋白档次违反次数',
   dataIndex: 'proteinGradeLevelViolationCount',
    width: 150,
  },
  {
    title: '产线均衡系数',
   dataIndex: 'lineBalanceCoefficient',
    width: 150,
  },
  {
    title: '创建时间',
   dataIndex: 'createTime',
    width: 150,
  },
];

//产线加工计划分页查询
export const linePlanColumns = [
  {
    title: '排产任务ID',
   dataIndex: 'taskId',
    width: 150,
  },
  {
    title: '产线编号',
   dataIndex: 'productionLineId',
    width: 150,
  },
  {
    title: '产线名称',
   dataIndex: 'productionLineName',
    width: 150,
  },
  {
    title: '产线优先级',
   dataIndex: 'productionLinePriority',
    width: 150,
  },
  {
    title: '混合机编号',
   dataIndex: 'mixerId',
    width: 150,
  },
  {
    title: '产线可用开始时间',
   dataIndex: 'lineAvailableStartTime',
    width: 150,
  },
  {
    title: '产线可用结束时间',
   dataIndex: 'lineAvailableEndTime',
    width: 150,
  },
  {
    title: '物料ID',
   dataIndex: 'productId',
    width: 150,
  },
  {
    title: '物料名称',
   dataIndex: 'productName',
    width: 150,
  },
  {
    title: '物料优先级',
   dataIndex: 'materialPriority',
    width: 150,
  },
  {
    title: '蛋白档次',
   dataIndex: 'proteinGradeLevel',
    width: 150,
  },
  {
    title: '理论环模',
   dataIndex: 'dia',
    width: 150,
  },
  {
    title: '加药标识',
   dataIndex: 'isDosing',
    width: 150,
    customRender: ({ text }) => ({ 1: '是', 0: '否' })[text] ?? '-',
  },
  {
    title: '加色标识',
   dataIndex: 'isColoring',
    width: 150,
    customRender: ({ text }) => ({ 1: '是', 0: '否' })[text] ?? '-',
  },
  {
    title: '特殊处理分组',
   dataIndex: 'specialProcessType',
    width: 150,
  },
  {
    title: '排产量（吨）',
   dataIndex: 'productionQuantity',
    width: 150,
  },
  {
    title: '开始切换时间',
   dataIndex: 'changeStartTime',
    width: 150,
  },
  {
    title: '结束切换时间（即加工开始时间）',
   dataIndex: 'processStartTime',
    width: 150,
  },
  {
    title: '加工结束时间',
   dataIndex: 'processEndTime',
    width: 150,
  },
  {
    title: '切换时间（分钟）',
   dataIndex: 'changeTime',
    width: 150,
  },
  {
    title: '加工时间（分钟）',
   dataIndex: 'processTime',
    width: 150,
  },
  {
    title: '创建时间',
   dataIndex: 'createTime',
    width: 150,
  },
];





//排产结果甘特图
export const productionPlanGantt = ref({
    "taskNo": "",
    "lineCount": 0,
    "blockCount": 0,
    "lines": [
      {
        "productionLineId": "",
        "productionLineName": "",
        "blocks": [
          {
            "id": "",
            "taskId": "",
            "productionLineId": "",
            "productionLineName": "",
            "productionLinePriority": 0,
            "mixerId": "",
            "lineAvailableStartTime": "",
            "lineAvailableEndTime": "",
            "productId": "",
            "productName": "",
            "materialPriority": 0,
            "proteinGradeLevel": 0,
            "dia": 0,
            "isDosing": 0,
            "isColoring": 0,
            "specialProcessType": "",
            "productionQuantity": 0,
            "changeStartTime": "",
            "processStartTime": "",
            "processEndTime": "",
            "changeTime": 0,
            "processTime": 0,
            "createTime": "",
            "blockId": "",
            "isSwitch": true,
            "blockStartTime": "",
            "blockEndTime": "",
            "blockDuration": 0
          }
        ]
      }
    ]
  })


/**============================排产结果页：图例 / 指标 / 甘特图辅助============================== */

// 甘特图色块用色（与图例一一对应：常规 / 加药+加色 / 仅加药 / 仅加色 / 切换准备）
export const blockColors = {
  normal: '#2f6bff',
  dosingColoring: '#ff4d4f',
  dosing: '#fa8c16',
  coloring: '#722ed1',
  switch: '#bfbfbf',
}

// 甘特图上方图例
export const legendItems = [
  {key: 'normal', title: '常规', color: blockColors.normal},
  {key: 'dosingColoring', title: '加药+加色', color: blockColors.dosingColoring},
  {key: 'dosing', title: '仅加药', color: blockColors.dosing},
  {key: 'coloring', title: '仅加色', color: blockColors.coloring},
  {key: 'switch', title: '切换准备', color: blockColors.switch},
]

// 色块类型 → 颜色
const typeColorMap = {
  常规: blockColors.normal,
  '加药+加色': blockColors.dosingColoring,
  仅加药: blockColors.dosing,
  仅加色: blockColors.coloring,
  切换准备: blockColors.switch,
}

//排产结果指标
export const productionPlanMetrics = ref({
  taskNo:'',//排产任务编号
  productionOrderCount:'',//生产订单数
  unfinishedOrderCount:'',//未完成订单数
  targetTotalQuantity:'',//目标总产量（吨）
  scheduledTotalQuantity:'',//排产总产量（吨）
  lineCount:'',//产线数
  lineTaskCount:'',//产线任务数（含切换）
  schedulingStartTime:'',//排产开始时间
  latestFinishTime:'',//最迟完工时间
  totalDurationMinutes:'',//总耗时时长（分钟）
  totalActualProcessMinutes:'',//所有产线实际生产时长（分钟）
  mixerCount:'',//混合机数
  mixerTaskCount:'',//混合机任务数
})
// 指标卡片配置（key 对应 productionPlanMetrics 字段）
export const metricCards = [
  // {key: 'taskNo', title: '排产任务编号', sub: '排产任务编号', color: '#2f6bff'},
  {key: 'productionOrderCount', title: '生产订单数', sub: '参与排产', color: '#722ed1'},
  {key: 'unfinishedOrderCount', title: '未完成订单数', sub: '未完成', color: '#ff4d4f'},
  {key: 'targetTotalQuantity', title: '目标总产量', sub: '吨', color: '#fa8c16'},
  {key: 'scheduledTotalQuantity', title: '总产量', sub: '吨', color: '#57606a'},
  {key: 'lineCount', title: '产线数', sub: '参与排产', color: '#2f6bff'},
  {key: 'lineTaskCount', title: '产线任务', sub: '含切换', color: '#722ed1'},
  // {key: 'schedulingStartTime', title: '排产开始时间', sub: '排产开始时间', color: '#57606a'},
  // {key: 'latestFinishTime', title: '最迟完工时间', sub: '最迟完工时间', color: '#57606a'},
  {key: 'totalDurationMinutes', title: '总耗时时长', sub: '分钟', color: '#ff4d4f'},
  {key: 'totalActualProcessMinutes', title: '所有产线实际生产时长', sub: '分钟', color: '#fa8c16'},
  {key: 'mixerTaskCount', title: '混合机任务', sub: '特殊时段', color: '#13c2c2'},
  {key: 'mixerCount', title: '混合机数', sub: '参与排产', color: '#ff4d4f'},



]

/**
 * 色块类型文案：切换准备优先，其余按加药 / 加色组合区分
 * @param block 甘特图色块（含 isSwitch / isDosing / isColoring）
 */
export function blockTypeLabel(block) {
  if (block.isSwitch) return '切换准备'
  const dosing = Number(block.isDosing) === 1
  const coloring = Number(block.isColoring) === 1
  if (dosing && coloring) return '加药+加色'
  if (dosing) return '仅加药'
  if (coloring) return '仅加色'
  return '常规'
}

/**
 * 色块取色：按类型文案映射到图例色
 * @param block 甘特图色块
 */
export function blockColor(block) {
  return typeColorMap[blockTypeLabel(block)] ?? blockColors.normal
}

/**
 * 时间字符串 → 时间戳
 * 'YYYY-MM-DD HH:mm:ss' 以空格分隔，Safari 的 Date.parse 无法解析，统一转 ISO 后再解析
 */
function toTimestamp(value) {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value === 'number') return value
  const ts = Date.parse(String(value).replace(' ', 'T'))
  return Number.isNaN(ts) ? undefined : ts
}

/**
 * 甘特图行数据（productionPlanGantt.lines）→ Highcharts 数据点
 * - 行 y 坐标 = 产线在 lines 中的下标，与左侧表格行序一致
 * - 加工块标签 = 物料ID + 排产量，切换块标签 = 「切换」
 * - 自定义字段透传，供 tooltip 展示
 * @param lines 排产结果甘特图的产线数组
 */
export function toTaskGanttData(lines) {
  const data = []
  ;(lines || []).forEach((line, y) => {
    ;(line.blocks || []).forEach((block) => {
      const isSwitch = !!block.isSwitch
      const quantity = block.productionQuantity
      data.push({
        id: block.blockId || block.id || `${line.productionLineId}-${y}`,
        name: isSwitch
          ? '切换'
          : `${block.productId ?? ''}${quantity !== null && quantity !== undefined && quantity !== '' ? ' ' + quantity + 't' : ''}`,
        start: toTimestamp(block.blockStartTime || block.changeStartTime),
        end: toTimestamp(block.blockEndTime || block.processEndTime),
        y,
        color: blockColor(block),
        borderColor: isSwitch ? '' : undefined,
        borderWidth: isSwitch ? 1 : undefined,
        // ---- 以下为 tooltip 自定义透传字段 ----
        isSwitch,
        typetitle: blockTypeLabel(block),
        productId: block.productId,
        productName: block.productName,
        productionQuantity: quantity,
        processTime: block.processTime,
        changeTime: block.changeTime,
        productionLineName: block.productionLineName || line.productionLineName,
      })
    })
  })
  return data
}

/**
 * 排产结果甘特图 Highcharts option
 * - 时间轴按小时刻度（HH:mm）展示，与排产结果的小时级区间对应
 * - y 轴分类 = 产线名称（名称由左侧表格展示，轴标签由 ZGanttTable 内部关闭）
 * @param categories y 轴产线名分类
 */
export function buildTaskGanttOption(categories = []) {
  return {
    chart: {
      spacingTop: 10,
      spacingBottom: 10,
      spacingRight: 0,
      marginRight: 0,
      plotBorderWidth: 0, // 隐藏图表边框
      scrollablePlotArea: {
        opacity: 0.5,
        minWidth: 1000,
        minHeight: 320,
        scrollPositionX: 0,
      },
    },
    boost: {useGPUTranslations: true, boostThreshold: 3000},
    // 悬浮提示：类型标签 + 物料 / 产线 / 排产量 / 加工与切换时长 / 起止时间
    tooltip: {
      enabled: true,
      useHTML: true,
      formatter: (ctx) => {
        const p = ctx?.point ?? {}
        const bg = p.color ?? blockColors.normal
        const rows = [
          ['产线', p.productionLineName ?? '--'],
          ['物料', `${p.productId ?? '--'}${p.productName ? '（' + p.productName + '）' : ''}`],
          ['排产量', p.productionQuantity !== null && p.productionQuantity !== undefined ? `${p.productionQuantity} 吨` : '--'],
          ['加工时长', p.processTime !== null && p.processTime !== undefined ? `${p.processTime} 分钟` : '--'],
          ['切换时长', p.changeTime !== null && p.changeTime !== undefined ? `${p.changeTime} 分钟` : '--'],
          [
            '时间',
            `${p.start ? dayjs(p.start).format('MM-DD HH:mm') : '--'} ~ ${p.end ? dayjs(p.end).format('MM-DD HH:mm') : '--'}`,
          ],
        ]
        return `
          <div style="min-width:200px;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
              <span style="background:${bg};color:#fff;font-size:11px;padding:0 6px;border-radius:9px;line-height:18px;">${p.typeLabel ?? ''}</span>
              <span style="font-weight:600;">${p.isSwitch ? '切换准备' : p.productName || p.productId || ''}</span>
            </div>
            <div style="font-size:12px;color:#666;line-height:20px;">
              ${rows.map(([k, v]) => `<div>${k}：${v}</div>`).join('')}
            </div>
          </div>`
      },
    },
    plotOptions: {
      gantt: {turboThreshold: 0, animation: false, pointPadding: 0.1},
      series: {
        dragDrop: {draggableX: false, draggableY: false},
      },
    },
    rangeSelector: {enabled: false},
    // 小时级时间轴：竖向网格线 + HH:mm 刻度
    xAxis: {
      gridLineWidth: 1,
      gridLineColor: 'rgba(0, 0, 0, 0.06)',
      tickInterval: 36e5,
      labels: {
        formatter() {
          return dayjs(this.value).format('HH:mm')
        },
      },
    },
    yAxis: {
      type: 'category',
      categories,
      min: 0,
      max: Math.max(categories.length - 1, 0),
    },
    series: [
      {
        turboThreshold: 0,
        name: '排产任务',
        dataLabels: {
          enabled: true,
          format: '{point.name}',
          style: {
            fontWeight: 'normal',
            textOutline: 'none',
            color: '#fff',
            fontSize: '11px',
          },
        },
      },
    ],
  }
}

/**
 * 分钟 → 「XhYmin」/「Ymin」，无有效值时展示 --
 * @param minutes 总时长（分钟）
 */
export function formatDuration(minutes) {
  const m = Number(minutes)
  if (!Number.isFinite(m) || m <= 0) return '--'
  const h = Math.floor(m / 60)
  const rest = Math.round(m % 60)
  if (h <= 0) return `${rest}min`
  return rest > 0 ? `${h}h${rest}min` : `${h}h`
}