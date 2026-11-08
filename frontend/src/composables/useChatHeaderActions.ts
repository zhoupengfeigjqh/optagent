/**
 * 聊天区头部与数字人装配（自 `useChatPanel.ts` 拆分，宪章原则二）。
 *
 * 覆盖头部的三个可交互面（会话内搜索栏、文件空间面板、「数字人」面板）与其内的切换动作。
 * 状态来源不变（`search` / `preview` / `workspace` / `agents`），本模块不新增字段来源。
 */
import { computed, ref } from 'vue'

import type { useAgents } from './useAgents'
import type { usePreview } from './usePreview'
import type { useSessionSearch } from './useSessionSearch'
import type { useWorkspace } from './useWorkspace'

export interface ChatHeaderDeps {
  agents: ReturnType<typeof useAgents>
  preview: ReturnType<typeof usePreview>
  search: ReturnType<typeof useSessionSearch>
  workspace: ReturnType<typeof useWorkspace>
}

/** 创建头部动作装配（必须在 `setup()` 内调用）。 */
export function useChatHeaderActions({ agents, preview, search, workspace }: ChatHeaderDeps) {
  /** 数字人面板展开状态 */
  const agentPanelOpen = ref(false)
  /**
   * 文件空间是否正停在列表态（用于工具栏按钮高亮与"再点一次收起"）。
   * 面板可能被消息内的文件引用打开在内容态，此时按钮不高亮。
   */
  const workspaceOpen = computed(() => preview.open.value && preview.view.value === 'list')

  /** 搜索栏开关：搜索状态已在 `useSessionSearch` */
  function onToggleSearch(): void {
    if (search.isOpen.value) {
      search.close()
    } else {
      search.open()
    }
  }

  function onToggleWorkspace(): void {
    // 已停在列表态 → 再点即收起；否则展开并停在列表态（从内容态点也会退回列表）
    if (workspaceOpen.value) {
      preview.close()
      return
    }
    preview.openList()
    // 打开时刷新三空间的目录清单（FR-031）；目录数由数字人场景配置决定，不是固定值
    void workspace.load()
  }

  /** 搜索关键词受控：高亮与定位由 `useSessionSearch` + 列表共同完成（FR-029/030） */
  function onSearchKeyword(value: string): void {
    search.keyword.value = value
  }

  /** 展开时才拉候选清单（候选只在面板里用，闭合态没有拉取的理由） */
  async function onToggleAgent(): Promise<void> {
    const next = !agentPanelOpen.value
    agentPanelOpen.value = next
    if (next) {
      await agents.loadCandidates()
    }
  }

  function onCloseAgentPanel(): void {
    agentPanelOpen.value = false
  }

  /** 切换数字人：成功才收起面板，失败保持展开便于重试（FR-037） */
  async function onSwitchAgent(name: string): Promise<void> {
    await agents.switchTo(name)
    if (agents.currentAgent.value?.agent_name === name) {
      agentPanelOpen.value = false
    }
  }

  return {
    agentPanelOpen,
    workspaceOpen,
    onToggleSearch,
    onToggleWorkspace,
    onSearchKeyword,
    onToggleAgent,
    onCloseAgentPanel,
    onSwitchAgent,
  }
}
