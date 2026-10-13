/**
 * 下一步动作提示（007）：只读拉取封装。
 *
 * 两点刻意的设计（都不是"顺手简化"）：
 *
 * 1. **失败即空形态，且不抛错**：本能力是回答之外的**附加信息**，
 *    没有建议与拿不到建议对用户是**同一件事**（FR-042）。若把失败抛给上层，
 *    调用方势必要么写 try/catch 再吞掉，要么误把它变成错误态——不如在这里就收敛掉。
 * 2. **形状校验**：端点返回值决定"界面上有没有卡片"，一行脏数据（如 `actions` 不是数组）
 *    不该把消息列表渲染成空。校验不过 → 空形态（与"没建议"同一条路）。
 *
 * 拉取语义（007 修订）：本 API 现在只服务**会话恢复**（选中 / 刷新 / 切回会话时
 * 一次性拉取最新卡片）；流式轮的卡片由 SSE `done` 事件直推（`api/messages.ts`），
 * 不再走轮询窗口——拉到空即"该会话最新一轮没有卡片"，就是终态。
 */

import type { HttpClient } from './http'
import type { AgentStarter } from './types'
import type { ThreadNextSteps } from './threads'

/** 下一步动作提示 API。 */
export interface NextStepsApi {
  /** 拉取某会话最新一轮的卡片；任何失败 → 空形态（**永不抛错**） */
  fetch(threadId: string): Promise<ThreadNextSteps>
}

/** 空形态（常量工厂：每次返回新对象，避免调用方就地改共享引用）。 */
export function emptyNextSteps(): ThreadNextSteps {
  return { message_id: null, actions: [] }
}

/** 创建下一步动作提示 API。 */
export function createNextStepsApi(client: HttpClient): NextStepsApi {
  return {
    async fetch(threadId: string): Promise<ThreadNextSteps> {
      try {
        const body = await client.get<unknown>(
          `/api/threads/${encodeURIComponent(threadId)}/next-actions`,
        )
        return normalizeNextSteps(body)
      } catch {
        // 静默降级：网络失败 / 404 / 5xx 在这里一视同仁（PR-042：降级 MUST NOT 呈现错误）
        return emptyNextSteps()
      }
    },
  }
}

/**
 * 形状校验：不合法一律空形态（防线在渲染之前，而不是在组件里）。
 *
 * 导出给 `api/messages.ts` 复用：SSE `done` 事件的 `next_actions` 字段与本端点
 * 是**同一份快照**的两个出口，形状校验必须同一条实现（TR-02 唯一实现原则）。
 */
export function normalizeNextSteps(raw: unknown): ThreadNextSteps {
  if (raw === null || typeof raw !== 'object') return emptyNextSteps()
  const record = raw as { message_id?: unknown; actions?: unknown }
  if (typeof record.message_id !== 'string' || !Array.isArray(record.actions)) {
    return emptyNextSteps()
  }
  const actions: AgentStarter[] = []
  for (const item of record.actions) {
    const action = toAction(item)
    if (action) actions.push(action)
  }
  // 逐条校验后为空 = 与"没有建议"同一条路（不留下"有 message_id 却没有卡片"的半截状态）
  if (actions.length === 0) return emptyNextSteps()
  return { message_id: record.message_id, actions }
}

/** 单条卡片：文本必填；`tools` / `guidance` 缺失时补齐，保证下发形态与 `AgentStarter` 完全一致 */
function toAction(value: unknown): AgentStarter | null {
  if (value === null || typeof value !== 'object') return null
  const record = value as { prompt?: unknown; tools?: unknown; guidance?: unknown }
  if (typeof record.prompt !== 'string' || record.prompt === '') return null
  return {
    prompt: record.prompt,
    tools: Array.isArray(record.tools) ? (record.tools as AgentStarter['tools']) : [],
    guidance: typeof record.guidance === 'string' ? record.guidance : '',
  }
}
