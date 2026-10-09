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
 * - 记忆的是**用户主动展开过的**条目，量级可控（一条布尔；正文仅限用户点开看过的）
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

const panels = reactive<Record<string, ToolPanelState>>({})
const details = reactive<Record<string, boolean>>({})

const shared: ToolPanels = {
  panelOf(callId: string): ToolPanelState {
    if (!panels[callId]) {
      panels[callId] = { open: false, loading: false, content: null, expired: false, error: null }
    }
    return panels[callId]!
  },
  isDetailsOpen(groupKey: string): boolean {
    return details[groupKey] === true
  },
  setDetailsOpen(groupKey: string, open: boolean): void {
    details[groupKey] = open
  },
  reset(): void {
    for (const key of Object.keys(panels)) delete panels[key]
    for (const key of Object.keys(details)) delete details[key]
  },
}

/** 取用（模块级单例的）工具查看态——单一入口，便于测试重置与将来换实现。 */
export function useToolPanels(): ToolPanels {
  return shared
}
