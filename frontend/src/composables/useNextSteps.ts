/**
 * 下一步动作提示（007 修订 · Tail Protocol）：卡片状态持有者。
 *
 * 修订后卡片与回答同流产出、随 `done` 事件直推——本层不再有"轮末拉取窗口"
 * （固定窗口、代次作废机制随独立生成链一起废除），只剩三个入口：
 *
 * 1. `apply`：done 直推（`useChatStream` 收到 done 时调用），写入当轮卡片；
 * 2. `reset`：发起新一轮即清空（`useChatPanel.onSend` 调用，与后端轮开始 clear 同刻）；
 * 3. 会话选中 / 新建 / URL 恢复：watch `activeThreadId` → 清空 + **一次性** GET
 *    恢复该会话最新一轮的卡片（修订 G3：刷新后卡片不消失；G4：与数字人无关）。
 *
 * 两条不变约束（沿用修订前口径）：
 * - 附加信息失败即空形态，绝不呈错误态（FR-042）；
 * - 过期响应丢弃：任何异步返回时先校验"仍在该会话"，杜绝旧会话卡片盖在新会话上。
 */

import { ref, watch, type Ref } from 'vue'

import { emptyNextSteps, type NextStepsApi } from '../api/next-steps'
import type { ThreadNextSteps } from '../api/threads'
import { useSession } from './useAppSession'

/** store 构造参数。 */
export interface NextStepsStoreOptions {
  nextSteps: NextStepsApi
  /**
   * 当前会话 id（与 `useThreads` 共享同一 ref）：**切换即清空**——
   * 卡片只属于某一轮，跨会话留着会张冠李戴。
   */
  activeThreadId: Readonly<Ref<string | null>>
}

/** 下一步动作提示 store。 */
export interface NextStepsStore {
  /** 当前生效的卡片（空形态 = 不渲染） */
  readonly steps: Readonly<Ref<ThreadNextSteps>>
  /** done 直推：写入当轮卡片（本轮无卡片时后端缺省字段，前端不调用） */
  apply(steps: ThreadNextSteps): void
  /** 发起新一轮：清空上一轮卡片（切换会话 / 卸载时也调用） */
  reset(): void
}

/** 创建 store。 */
export function createNextStepsStore(options: NextStepsStoreOptions): NextStepsStore {
  const steps = ref<ThreadNextSteps>(emptyNextSteps())

  /** 会话恢复拉取：**一次性**，结果仍属于当前会话才写入 */
  async function restore(threadId: string): Promise<void> {
    let result: ThreadNextSteps
    try {
      result = await options.nextSteps.fetch(threadId)
    } catch {
      // 兜底（api 层已把失败收敛成空形态）：这里再兜一次，避免 `void restore(...)` 变成
      // unhandled rejection —— 附加能力失败绝不能打扰用户，也不能污染控制台
      return
    }
    // 过期响应：用户已切走
    if (options.activeThreadId.value !== threadId) return
    steps.value = result
  }

  /**
   * 切换 / 新建 / 恢复会话：清空 + 拉取最新一轮卡片（含"退出到无会话"）。
   *
   * 契约：本 watch **只认"变化"**，故 `activeThreadId` 的持有者 MUST NOT 在订阅前预置初值
   * （见 `useAppSession`）——刷新恢复依赖"装配期 null → 视图 select 写入目标 id"这一次变化。
   */
  watch(options.activeThreadId, (threadId) => {
    steps.value = emptyNextSteps()
    if (threadId !== null) void restore(threadId)
  })

  function apply(next: ThreadNextSteps): void {
    steps.value = next
  }

  function reset(): void {
    steps.value = emptyNextSteps()
  }

  return { steps, apply, reset }
}

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useNextSteps(): NextStepsStore {
  return useSession().nextSteps
}
