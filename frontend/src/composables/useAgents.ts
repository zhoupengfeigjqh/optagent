/**
 * 数字人与 MCP 状态（FR-032~FR-038、SC-010、V-14）
 *
 * ⚠️ 后端 `POST /api/agents/{name}/select` 为**覆盖式**选中：可在任意时刻切换，
 * 无需先 `exit`，也不校验会话是否进行中；切换后的新数字人在**下一轮对话**时激活。
 * "会话进行中禁止切换"是**纯前端 UX 约束**（V-14），本 composable 通过 `switchingDisabled`
 * 在 `phase === 'streaming'` 时**不发请求**来兜住。
 *
 * 切换流程为**单次 `select`**（FR-037 修订）：同一时刻仍只有一个"当前选中数字人"，
 * 但切换是直接覆盖，不再需要"先退出"；会话可跨数字人（下一轮生效）。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { AgentsApi } from '../api/agents'
import type { DigitalHuman, ErrorInfo, McpServiceStatus } from '../api/types'
import { RUN_PHASE, type RunPhase } from '../constants/events'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/** 构造参数。 */
export interface AgentsDeps {
  agents: AgentsApi
  /** 读取本轮运行阶段（决定是否禁用切换） */
  getPhase: () => RunPhase
  toast?: ToastStore
  /** 切换成功后的回调（用于刷新会话列表等） */
  onSwitched?: () => void | Promise<void>
}

/** 数字人 composable 契约。 */
export interface AgentsStore {
  currentAgent: Readonly<Ref<DigitalHuman | null>>
  mcpServers: Readonly<Ref<McpServiceStatus[]>>
  candidates: Readonly<Ref<DigitalHuman[]>>
  loading: Readonly<Ref<boolean>>
  switching: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** `phase === 'streaming'` 时为 `true`（V-06、V-14） */
  switchingDisabled: ComputedRef<boolean>
  loadCurrent(): Promise<void>
  loadDetail(name: string): Promise<void>
  loadCandidates(): Promise<void>
  refreshMcp(): Promise<void>
  switchTo(name: string): Promise<void>
  startMcpSubscription(): void
  stopMcpSubscription(): void
}

/** 创建数字人状态。 */
export function createAgentsStore(deps: AgentsDeps): AgentsStore {
  const currentAgent = ref<DigitalHuman | null>(null)
  const mcpServers = ref<McpServiceStatus[]>([])
  const candidates = ref<DigitalHuman[]>([])
  const loading = ref(false)
  const switching = ref(false)
  const error = ref<ErrorInfo | null>(null)

  let unsubscribe: (() => void) | null = null

  const switchingDisabled = computed(() => deps.getPhase() === RUN_PHASE.STREAMING)

  async function loadDetail(name: string): Promise<void> {
    try {
      currentAgent.value = await deps.agents.detail(name)
    } catch (cause) {
      error.value = toErrorInfo(cause)
      currentAgent.value = null
    }
  }

  async function refreshMcp(): Promise<void> {
    try {
      const response = await deps.agents.currentMcp()
      // 实例未创建或首次建连进行中时后端返回 unknown：属正常状态，不视为异常（FR-034、FR-038）
      mcpServers.value = response.mcp_servers ?? []
    } catch {
      // MCP 状态为观测信息，失败不阻断主流程、不弹窗
    }
  }

  async function loadCurrent(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const response = await deps.agents.current()
      const name = response.agent_name
      if (!name) {
        // 未选定：提示文案由组件渲染，此处仅保持空状态（FR-032）
        currentAgent.value = null
        mcpServers.value = []
        return
      }
      await loadDetail(name)
      await refreshMcp()
    } catch (cause) {
      error.value = toErrorInfo(cause)
      currentAgent.value = null
      mcpServers.value = []
    } finally {
      loading.value = false
    }
  }

  async function loadCandidates(): Promise<void> {
    try {
      const list = await deps.agents.list()
      const details = await Promise.all(
        list.map((item) => deps.agents.detail(item.agent_name).catch(() => null)),
      )
      candidates.value = details.filter((item): item is DigitalHuman => item !== null)
    } catch (cause) {
      error.value = toErrorInfo(cause)
      candidates.value = []
    }
  }

  async function switchTo(name: string): Promise<void> {
    // 进行中禁止切换：不发请求（V-14、FR-036）
    if (switchingDisabled.value || switching.value) {
      return
    }
    if (currentAgent.value?.agent_name === name) {
      return
    }

    switching.value = true
    try {
      // 覆盖式选中：无需先 exit（FR-037 修订）；会话可跨数字人，下一轮生效
      await deps.agents.select(name)
      await loadCurrent()
      deps.toast?.push('success', '已切换数字人，下一轮对话生效')
      await deps.onSwitched?.()
    } catch (cause) {
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
    } finally {
      switching.value = false
    }
  }

  /**
   * 订阅后端 MCP 状态推送（SSE），替代原 5s 轮询：
   * 建连落定 / 切换 / 退出时后端主动推送快照，时延更低且无空转请求。
   * 推送快照以后端"当前选中"为准，直接采用；断线由 EventSource 自动重连。
   */
  function startMcpSubscription(): void {
    if (unsubscribe !== null) {
      return
    }
    try {
      unsubscribe = deps.agents.subscribeMcp((snapshot) => {
        mcpServers.value = snapshot.mcp_servers ?? []
      })
    } catch {
      // SSE 不可用（极端环境）：保持 loadCurrent 的一次性结果，不影响主流程
      unsubscribe = null
    }
  }

  function stopMcpSubscription(): void {
    if (unsubscribe === null) {
      return
    }
    unsubscribe()
    unsubscribe = null
  }

  return {
    currentAgent,
    mcpServers,
    candidates,
    loading,
    switching,
    error,
    switchingDisabled,
    loadCurrent,
    loadDetail,
    loadCandidates,
    refreshMcp,
    switchTo,
    startMcpSubscription,
    stopMcpSubscription,
  }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useAgents(): AgentsStore {
  return useSession().agents
}
