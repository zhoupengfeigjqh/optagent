/**
 * 数字人与 MCP 状态（FR-032~FR-038、SC-010、V-14）
 *
 * ⚠️ 后端 `POST /api/agents/{name}/select` 为**覆盖式**选中：可在任意时刻切换，
 * 无需先 `exit`，也不校验会话是否进行中；切换后的新数字人在**下一轮对话**时激活。
 * "禁止切换"是**纯前端 UX 约束**（V-14），本 composable 通过 `switchingDisabled`
 * **不发请求**来兜住。禁用态只有一种：`phase === 'streaming'`（一轮回答正在进行，
 * 思考与工具调用都在此阶段内）。对话**结束**（completed / failed / aborted）后即可切换，
 * 切换后由 `onSwitched` 进入新的空对话视图（会话按数字人隔离，FR-022）。
 *
 * 禁用**原因文案**由 `AgentPanel.vue` 呈现（只置灰不解释等于让用户猜，FR-015 要求可读提示）。
 *
 * 切换流程为**单次 `select`**（FR-037 修订）：同一时刻仍只有一个"当前选中数字人"，
 * 但切换是直接覆盖，不再需要"先退出"。
 *
 * 009（数字人数据隔离）：会话与文件都按数字人隔离，因此切换后的收尾动作为
 * **进入新的空对话视图**（`onSwitched` 里 `threads.startNew()`）——不再"续用同一会话"。
 */

import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { AgentsApi } from '../api/agents'
import type { CurrentMcpResponse, DigitalHuman, ErrorInfo, McpServiceStatus } from '../api/types'
import { RUN_PHASE, type RunPhase } from '../constants/events'
import { toErrorInfo, toUserMessage } from '../utils/error-message'
import { useSession } from './useAppSession'
import type { ToastStore } from './useToast'

/**
 * 等待 MCP 出现连接结果时的兜底轮询间隔（毫秒）。
 *
 * 只在前端"点击发送且仍有灰"的窗口内轮询，上限 10s，不是常驻轮询
 * （常驻的 5s 轮询早已被 SSE 取代，勿恢复）。
 */
const MCP_READY_POLL_MS = 500

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
  /** 是否仍有服务处于 `unknown`（灰 = 尚无连接结果）；发送前据此决定是否等待 */
  mcpPending: ComputedRef<boolean>
  candidates: Readonly<Ref<DigitalHuman[]>>
  loading: Readonly<Ref<boolean>>
  switching: Readonly<Ref<boolean>>
  error: Readonly<Ref<ErrorInfo | null>>
  /** 一轮回答进行中时为 `true`（V-06、V-14）；对话结束即可切换 */
  switchingDisabled: ComputedRef<boolean>
  /** 禁用**原因**（可读文案）；可切换时为 `null`（FR-015：只置灰不解释等于让用户猜） */
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

/** 创建数字人状态。 */
export function createAgentsStore(deps: AgentsDeps): AgentsStore {
  const currentAgent = ref<DigitalHuman | null>(null)
  const mcpServers = ref<McpServiceStatus[]>([])
  const candidates = ref<DigitalHuman[]>([])
  const loading = ref(false)
  const switching = ref(false)
  const error = ref<ErrorInfo | null>(null)

  let unsubscribe: (() => void) | null = null

  /** 灰 = 尚无连接结果：有任意一个就说明"此刻提交可能拿不到该服务的工具" */
  const mcpPending = computed(() => mcpServers.value.some((item) => item.status === 'unknown'))

  const streaming = computed(() => deps.getPhase() === RUN_PHASE.STREAMING)

  /** 禁用判据单一实现（V-14）：仅"回答进行中"禁用；对话结束（completed/failed/aborted）即可切换 */
  const switchingDisabled = computed(() => streaming.value)

  /** 禁用原因（可读文案）：只在"回答进行中"出现；其余时刻为 `null`（可切换） */
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

  /**
   * 采用快照前的**归属校验**（2026-10-18）。
   *
   * `GET .../mcp`、`POST .../mcp/warm` 与 SSE 三条来源会交错：切换数字人瞬间旧数字人的
   * 快照仍可能在途（后端按"推送时刻的选中"重算，但网络与 Vue 更新顺序不保证）。
   * 归属不一致即丢弃——否则"旧人的绿"会被当成"本人的绿"，发送前的灰色等待就会误放行。
   */
  function applyMcpSnapshot(snapshot: CurrentMcpResponse): void {
    const current = currentAgent.value?.agent_name ?? null
    if (current !== null && snapshot.agent_name !== null && snapshot.agent_name !== current) return
    mcpServers.value = snapshot.mcp_servers ?? []
  }

  async function refreshMcp(): Promise<void> {
    try {
      const response = await deps.agents.currentMcp()
      // 实例未创建或首次建连进行中时后端返回 unknown：属正常状态，不视为异常（FR-034、FR-038）
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

  /**
   * 有界等待"灰色消失"（2026-10-18）。
   *
   * 三重驱动：先发一次预热（实例不存在时后端不会自己建），随后 SSE 会推落定结果；
   * 同时每 500ms 兜底拉一次 GET——SSE 在极端环境（代理/禁用）可能根本订阅不上，
   * 只等推送会必然超时。
   *
   * @returns `true` = 每个服务都有连接结果（connected / failed，含"没有 MCP 服务"）；
   *   `false` = 等待超时。超时不改状态，调用方按降级继续（原则九）。
   */
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
        // 未选定：提示文案由组件渲染，此处仅保持空状态（FR-032）
        currentAgent.value = null
        mcpServers.value = []
        return
      }
      await loadDetail(name)
      await refreshMcp()
      // 预热（2026-10-18）：不建实例，MCP 状态就会恒灰（此前只有发一轮对话才建）。
      // 放在 loadCurrent 这个"当前数字人已确定"的唯一收口上：挂载与切换都自动覆盖。
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
      // 覆盖式选中：无需先 exit（FR-037 修订）；后续动作（进入新对话视图）由装配方编排
      await deps.agents.select(name)
      // loadCurrent 内部会预热新数字人：建连提前到"用户开始打字之前"，点击发送时通常已有结果
      await loadCurrent()
      // 009：会话按数字人隔离，切换即进入新的空对话（由 onSwitched 落 `threads.startNew()`）
      deps.toast?.push('success', '已切换数字人，已开启新对话')
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

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useAgents(): AgentsStore {
  return useSession().agents
}
