import { ref, type Ref } from 'vue'

import { useAgents } from './useAgents'
import type { ToastStore } from './useToast'
import { useToast } from './useToast'

/**
 * 前端等待上限（毫秒），与后端 `MCP_CONNECT_TIMEOUT_MS`（默认 10s）对齐：
 * 后端到点会把仍在飞行的建连判 failed 并推送，前端只需略等这个窗口。
 */
export const MCP_READY_TIMEOUT_MS = 10_000

export interface McpReadyGateDeps {
  hasPending: () => boolean
  /** 等待出连接结果；`true` = 已有结果，`false` = 超时 */
  waitForResult: (timeoutMs: number) => Promise<boolean>
  toast: Pick<ToastStore, 'push'>
}

export interface McpReadyGate {
  /** 等待是否进行中（输入区与发送入口据此禁用，避免重复提交） */
  preparing: Readonly<Ref<boolean>>
  /** 等出连接结果（含无 MCP 服务 / 超时降级）；恒 resolve，不 reject */
  waitMcpReady(): Promise<boolean>
}

export function createMcpReadyGate(deps: McpReadyGateDeps): McpReadyGate {
  const preparing = ref(false)

  async function waitMcpReady(): Promise<boolean> {
    if (!deps.hasPending()) return true
    preparing.value = true
    try {
      const ready = await deps.waitForResult(MCP_READY_TIMEOUT_MS).catch(() => false)
      if (!ready) deps.toast.push('info', 'MCP 服务连接超时，本轮可能缺少相关工具')
      return true
    } finally {
      preparing.value = false
    }
  }

  return { preparing, waitMcpReady }
}

/** 组件内取用（必须在 `setup()` 内调用）。 */
export function useMcpReadyGate(): McpReadyGate {
  const agents = useAgents()
  const toast = useToast()
  return createMcpReadyGate({
    hasPending: () => agents.mcpPending.value,
    waitForResult: (timeoutMs) => agents.ensureMcpReady(timeoutMs),
    toast,
  })
}
