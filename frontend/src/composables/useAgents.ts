
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { AgentsApi } from '../api/agents'
import type { CurrentMcpResponse, DigitalHuman, ErrorInfo, McpServiceStatus } from '../api/types'
import { RUN_PHASE, type RunPhase } from '../constants/events'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

const MCP_READY_POLL_MS = 2_000

export interface AgentsDeps {
  agents: AgentsApi
  getPhase: () => RunPhase
  toast?: ToastStore
  onSwitched?: () => void | Promise<void>
}

export interface AgentsStore {
  currentAgent: Readonly<Ref<DigitalHuman | null>>
  mcpServers: Readonly<Ref<McpServiceStatus[]>>
  mcpPending: ComputedRef<boolean>
  candidates: Readonly<Ref<DigitalHuman[]>>
  loading: Readonly<Ref<boolean>>
  switching: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  switchingDisabled: ComputedRef<boolean>
  switchingDisabledReason: ComputedRef<string | null>
  loadCurrent(): Promise<void>
  loadDetail(name: string): Promise<void>
  loadCandidates(): Promise<void>
  refreshMcp(): Promise<void>
  /** 显式预热（幂等）：让后端建实例并开始建连，返回落定后的快照 */
  warmMcp(): Promise<void>
  /**
   * 有界等待"灰色消失"（每个服务都有连接结果：connected / failed）。
   * @returns `true` 已有结果（含无 MCP 服务）；`false` 等待超时（调用方降级放行）
   */
  ensureMcpReady(timeoutMs: number): Promise<boolean>
  switchTo(name: string): Promise<void>
  startMcpSubscription(): void
  stopMcpSubscription(): void
}

export function createAgentsStore(deps: AgentsDeps): AgentsStore {
  const currentAgent = ref<DigitalHuman | null>(null)
  const mcpServers = ref<McpServiceStatus[]>([])
  const candidates = ref<DigitalHuman[]>([])
  const loading = ref(false)
  const switching = ref(false)
  const error = ref<ErrorInfo | null>(null)

  let unsubscribe: (() => void) | null = null

  const mcpPending = computed(() => mcpServers.value.some((item) => item.status === 'unknown'))

  const streaming = computed(() => deps.getPhase() === RUN_PHASE.STREAMING)

  const switchingDisabled = computed(() => streaming.value)

  const switchingDisabledReason = computed(() =>
    streaming.value ? '回答进行中，暂时无法切换数字人' : null,
  )

  async function loadDetail(name: string): Promise<void> {
    try {
      currentAgent.value = await deps.agents.detail(name)
    } catch (cause) {
      error.value = toErrorInfo(cause)
      currentAgent.value = null
    }
  }

  function applyMcpSnapshot(snapshot: CurrentMcpResponse): void {
    const current = currentAgent.value?.agent_name ?? null
    if (current !== null && snapshot.agent_name !== null && snapshot.agent_name !== current) return
    mcpServers.value = snapshot.mcp_servers ?? []
  }

  async function refreshMcp(): Promise<void> {
    try {
      const response = await deps.agents.currentMcp()
      applyMcpSnapshot(response)
    } catch {
      // MCP 状态为观测信息，失败不阻断主流程、不弹窗
    }
  }

  /**
   * 显式预热（2026-10-18）：让后端为当前数字人建实例并开始建连。
   *
   * 起因：实例是惰性创建的，此前"灰变绿"的唯一触发方式是发一轮对话。预热把它提前到
   * 挂载 / 切换 / 点击发送三个时机，绝大多数情况下用户打完字时状态已经落定。
   * 预热属体验优化：失败不弹窗（保持灰，由发送前等待的超时兜底）。
   */
  async function warmMcp(): Promise<void> {
    const warm = deps.agents.warmMcp
    // 兼容既有测试桩（未声明该方法时按"未接入"处理）
    if (!warm) return
    try {
      applyMcpSnapshot(await warm())
    } catch {
      // 池满 / 配置损坏 / 超时：均不影响主流程
    }
  }

  async function ensureMcpReady(timeoutMs: number): Promise<boolean> {
    if (!mcpPending.value) return true
    const deadline = Date.now() + timeoutMs
    void warmMcp()
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MCP_READY_POLL_MS))
      await refreshMcp()
      if (!mcpPending.value) return true
    }
    return !mcpPending.value
  }

  async function loadCurrent(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const response = await deps.agents.current()
      const name = response.agent_name
      if (!name) {
        currentAgent.value = null
        mcpServers.value = []
        return
      }
      await loadDetail(name)
      await refreshMcp()
      void warmMcp()
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
    // 切换瞬间先清空：旧数字人的连接结果 MUST NOT 被当成本人的（SSE 与 GET 会交错）
    mcpServers.value = []
    try {
      await deps.agents.select(name)
      await loadCurrent()
      deps.toast?.push('success', '已切换数字人，已开启新对话')
      await deps.onSwitched?.()
    } catch (cause) {
      deps.toast?.push('error', toUserMessage(toErrorInfo(cause)))
    } finally {
      switching.value = false
    }
  }

  function startMcpSubscription(): void {
    if (unsubscribe !== null) {
      return
    }
    try {
      unsubscribe = deps.agents.subscribeMcp((snapshot) => {
        // 归属校验（2026-10-18）：切人瞬间的旧快照不得写进新数字人的状态
        applyMcpSnapshot(snapshot)
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
    mcpPending,
    candidates,
    loading,
    switching,
    error,
    switchingDisabled,
    switchingDisabledReason,
    loadCurrent,
    loadDetail,
    loadCandidates,
    refreshMcp,
    warmMcp,
    ensureMcpReady,
    switchTo,
    startMcpSubscription,
    stopMcpSubscription,
  }
}

export function useAgents(): AgentsStore {
  return useSession().agents
}
