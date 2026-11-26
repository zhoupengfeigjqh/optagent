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
  const agentPanelOpen = ref(false)
  const workspaceOpen = computed(() => preview.open.value && preview.view.value === 'list')

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
    void workspace.load()
  }

  function onSearchKeyword(value: string): void {
    search.keyword.value = value
  }

  /**
   * 打开数字人面板（**幂等**，2026-11-18）。
   *
   * 入口已从「头部开关按钮」改为账号菜单的「切换数字人」，菜单项语义是**打开**而非开关：
   * 已展开时不关闭、也不重复拉候选（候选只在面板里用，闭合态没有拉取的理由）。
   * 面板自身的关闭走 `onCloseAgentPanel`，两条意图不共用同一个函数。
   */
  async function onOpenAgentPanel(): Promise<void> {
    if (agentPanelOpen.value) return
    agentPanelOpen.value = true
    await agents.loadCandidates()
  }

  function onCloseAgentPanel(): void {
    agentPanelOpen.value = false
  }

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
    onOpenAgentPanel,
    onCloseAgentPanel,
    onSwitchAgent,
  }
}
