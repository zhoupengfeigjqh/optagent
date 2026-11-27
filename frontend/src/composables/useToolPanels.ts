import { reactive } from 'vue'

export interface ToolPanelState {
  open: boolean
  /**
   * 结果正文是否**按原始 JSON 展示**（`false` = 能结构化就结构化，2026-10-10）。
   *
   * 与"查看态"同放一处的理由相同：默认结构化渲染后必须保留回看原文的逃生舱
   * （与产出弹窗的「按原始 JSON 查看」同口径），且该开关 MUST NOT 随流式→历史交接丢失。
   */
  raw: boolean
}

export interface ToolPanels {
  panelOf(callId: string): ToolPanelState
  isDetailsOpen(groupKey: string): boolean
  setDetailsOpen(groupKey: string, open: boolean): void
  reset(): void
}

/** 记忆上限：长会话里"出现过的工具调用数"可能很大，按键 FIFO 淘汰最旧的 */
const MAX_PANELS = 200
const MAX_DETAILS = 200

const panels = reactive<Record<string, ToolPanelState>>({})
const details = reactive<Record<string, boolean>>({})

const panelOrder: string[] = []
const detailsOrder: string[] = []

/** 插入前腾位：超过上限就按插入顺序删最旧的（FIFO，不做访问刷新以免每次读都触发响应式写） */
function ensureRoom(
  record: Record<string, unknown>,
  order: string[],
  key: string,
  max: number,
): void {
  order.push(key)
  while (order.length > max) {
    const oldest = order.shift()
    if (oldest !== undefined) delete record[oldest]
  }
}

const shared: ToolPanels = {
  panelOf(callId: string): ToolPanelState {
    if (!panels[callId]) {
      ensureRoom(panels, panelOrder, callId, MAX_PANELS)
      panels[callId] = { open: false, raw: false }
    }
    return panels[callId]!
  },
  isDetailsOpen(groupKey: string): boolean {
    return details[groupKey] === true
  },
  setDetailsOpen(groupKey: string, open: boolean): void {
    if (!(groupKey in details)) ensureRoom(details, detailsOrder, groupKey, MAX_DETAILS)
    details[groupKey] = open
  },
  reset(): void {
    for (const key of Object.keys(panels)) delete panels[key]
    for (const key of Object.keys(details)) delete details[key]
    // 顺序表必须一起清：否则残留的旧键会让新条目被"提前淘汰"
    panelOrder.length = 0
    detailsOrder.length = 0
  },
}

export function useToolPanels(): ToolPanels {
  return shared
}
