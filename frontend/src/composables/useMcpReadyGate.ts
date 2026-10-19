/**
 * 发送前的 MCP 就绪门（2026-10-18）。
 *
 * 背景：MCP 实例是**惰性创建**的，此前"灰变绿"的唯一触发方式是发一轮对话；
 * 而一轮对话的工具装配只收已建连的服务 —— 于是出现"第一轮没有 MCP 工具、
 * 答完才变绿"的体验问题。
 *
 * 本模块只做一件事：点击发送时若仍有灰色（`unknown` = 尚无连接结果），
 * 先唤醒并**有界等待**它变成绿/红，再放行提交。超时即降级放行并提示
 * （原则九：有界等待 + 用户可感知 + 不因单个服务挂掉而阻断聊天）。
 *
 * 为什么独立成 composable：`useChatPanel` 已逼近单文件 500 行门禁；且"等状态"
 * 与"编排发送"是两件事，独立后可单独测（覆盖超时/异常两条降级分支）。
 */
import { ref, type Ref } from 'vue'

import { useAgents } from './useAgents'
import type { ToastStore } from './useToast'
import { useToast } from './useToast'

/**
 * 前端等待上限（毫秒），与后端 `MCP_CONNECT_TIMEOUT_MS`（默认 10s）对齐：
 * 后端到点会把仍在飞行的建连判 failed 并推送，前端只需略等这个窗口。
 */
export const MCP_READY_TIMEOUT_MS = 10_000

/** 就绪门依赖（能力抽象，便于单测注入桩）。 */
export interface McpReadyGateDeps {
  /** 是否仍有灰色（尚无连接结果） */
  hasPending: () => boolean
  /** 等待出连接结果；`true` = 已有结果，`false` = 超时 */
  waitForResult: (timeoutMs: number) => Promise<boolean>
  toast: Pick<ToastStore, 'push'>
}

/** 就绪门契约。 */
export interface McpReadyGate {
  /** 等待是否进行中（输入区与发送入口据此禁用，避免重复提交） */
  preparing: Readonly<Ref<boolean>>
  /** 等出连接结果（含无 MCP 服务 / 超时降级）；恒 resolve，不 reject */
  waitMcpReady(): Promise<boolean>
}

/** 创建就绪门（纯依赖注入，测试可直接构造）。 */
export function createMcpReadyGate(deps: McpReadyGateDeps): McpReadyGate {
  const preparing = ref(false)

  async function waitMcpReady(): Promise<boolean> {
    // 没有灰色（已全部有结果 / 该数字人未配 MCP）→ 零等待
    if (!deps.hasPending()) return true
    preparing.value = true
    try {
      // 等待本身有界；异常一律按"没等到"处理——发送不该因观测信息失败而中断
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
