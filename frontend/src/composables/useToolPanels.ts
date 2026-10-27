/**
 * 工具调用的**查看态**（002 特性；2026-10-08 改版为折叠展示，`TR-36`）
 *
 * 为什么不能在组件里存：流式气泡的合成消息 `id` 为空串，列表按 `key=message.id` 渲染；
 * 本轮结束时流式气泡卸载、历史消息挂载 → 组件**必然重建**，组件内状态（哪些面板展开了、
 * 懒加载到的正文）随旧实例一起销毁——用户看到的是"刚展开的明细与正文在回答结束瞬间自己收回去"。
 *
 * 故把查看态提升为**页面级、按 `call_id` 记忆**的模块状态：
 * - 生命周期：随页面会话存续；**不持久化**（刷新即回到收起态）
 * - 键：条目态用 `call_id`（每次调用唯一）；明细态用"该轮首个 `call_id`"（见 `toolGroupKey`）
 * - 切换会话不清空：键唯一，不会串味；"回头再看仍是你看过的样子"更符合直觉
 * - 量级**硬上限**（2026-10-27）：模板对每张卡片都会取态，实际是"本页出现过的工具调用数"，
 *   且 `content` 可达数百 KB；故按插入顺序 FIFO 淘汰（各 200 条），不再依赖"用户只展开少数"
 *
 * 注意：状态是模块级单例（跨组件实例共享），测试 MUST 用 `reset()` 隔离。
 */
import { reactive } from 'vue'

/** 单个工具调用的展开态。 */
export interface ToolPanelState {
  open: boolean
  loading: boolean
  /** 懒加载到的正文（`null` = 尚未加载） */
  content: string | null
  expired: boolean
  error: string | null
  /**
   * 结果正文是否**按原始 JSON 展示**（`false` = 能结构化就结构化，2026-10-10）。
   *
   * 与"查看态"同放一处的理由相同：默认结构化渲染后必须保留回看原文的逃生舱
   * （与产出弹窗的「按原始 JSON 查看」同口径），且该开关 MUST NOT 随流式→历史交接丢失。
   */
  raw: boolean
}

/** 查看态存取口。 */
export interface ToolPanels {
  /**
   * 取（必要时创建）某次调用的展开态。
   *
   * 必须**返回 reactive 代理**而不是刚 new 出来的原始对象——否则后续
   * `panel.loading = false` 不触发视图更新，卡片会永远停在"加载中"。
   */
  panelOf(callId: string): ToolPanelState
  /** 本轮明细是否展开 */
  isDetailsOpen(groupKey: string): boolean
  /** 设置本轮明细的展开态（同一 `groupKey` 在流式与历史两条路径上稳定） */
  setDetailsOpen(groupKey: string, open: boolean): void
  /** 清空全部记忆（测试隔离用） */
  reset(): void
}

/**
 * 记忆上限（2026-10-27）。
 *
 * 原注释假设"只记用户主动展开过的条目"，但模板对**每张**工具卡片都会调 `panelOf`
 * （`ToolCallList` 的 `resultViews` / `panelOf`），于是量级等同"本页出现过的工具调用数"；
 * `content` 又是懒加载到的正文（可达数百 KB），切会话不清空 → 长会话持续增长。
 * 这里按插入顺序 FIFO 淘汰最旧的，200 条足以覆盖单会话常见规模。
 */
const MAX_PANELS = 200
const MAX_DETAILS = 200

const panels = reactive<Record<string, ToolPanelState>>({})
const details = reactive<Record<string, boolean>>({})

/**
 * 显式维护插入顺序（不依赖 `Object.keys` 的枚举顺序）。
 *
 * 只记键、不记值：淘汰时按键删条目即可，正文随条目一起被回收。
 */
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
      panels[callId] = {
        open: false,
        loading: false,
        content: null,
        expired: false,
        error: null,
        raw: false,
      }
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

/** 取用（模块级单例的）工具查看态——单一入口，便于测试重置与将来换实现。 */
export function useToolPanels(): ToolPanels {
  return shared
}
