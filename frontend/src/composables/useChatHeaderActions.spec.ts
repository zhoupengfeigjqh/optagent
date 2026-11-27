import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { useChatHeaderActions } from './useChatHeaderActions'

function makeDeps() {
  return {
    search: {
      isOpen: ref(false),
      keyword: ref(''),
      open: vi.fn(),
      close: vi.fn(),
    },
    preview: {
      open: ref(false),
      view: ref('list'),
      close: vi.fn(),
      openList: vi.fn(),
    },
    workspace: {
      load: vi.fn(async () => undefined),
    },
    agents: {
      currentAgent: ref<{ agent_name: string } | null>(null),
      loadCandidates: vi.fn(async () => undefined),
      switchTo: vi.fn(async () => undefined),
    },
  }
}

type Deps = ReturnType<typeof makeDeps>

function mountActions(deps: Deps) {
  let actions!: ReturnType<typeof useChatHeaderActions>
  const Harness = defineComponent({
    setup() {
      actions = useChatHeaderActions(deps as unknown as Parameters<typeof useChatHeaderActions>[0])
      return () => h('div')
    },
  })
  mount(Harness)
  return actions
}

describe('useChatHeaderActions —— 搜索栏', () => {
  it('关闭态点开、打开态点关（不重复 open）', () => {
    const deps = makeDeps()
    const actions = mountActions(deps)

    actions.onToggleSearch()
    expect(deps.search.open).toHaveBeenCalledTimes(1)
    expect(deps.search.close).not.toHaveBeenCalled()

    deps.search.isOpen.value = true
    actions.onToggleSearch()
    expect(deps.search.close).toHaveBeenCalledTimes(1)
    expect(deps.search.open).toHaveBeenCalledTimes(1)
  })

  it('关键词受控：写入 `useSessionSearch` 的同一个 ref', () => {
    const deps = makeDeps()
    const actions = mountActions(deps)

    actions.onSearchKeyword('账期')
    expect(deps.search.keyword.value).toBe('账期')
  })
})

describe('useChatHeaderActions —— 文件空间面板', () => {
  it('已停在列表态 → 再点即收起（不动预览目标、不刷新清单）', () => {
    const deps = makeDeps()
    deps.preview.open.value = true
    deps.preview.view.value = 'list'
    const actions = mountActions(deps)

    expect(actions.workspaceOpen.value).toBe(true)
    actions.onToggleWorkspace()

    expect(deps.preview.close).toHaveBeenCalledTimes(1)
    expect(deps.preview.openList).not.toHaveBeenCalled()
    expect(deps.workspace.load).not.toHaveBeenCalled()
  })

  it('从内容态点 → 退回列表并刷新三空间的目录清单（FR-031）', () => {
    const deps = makeDeps()
    deps.preview.open.value = true
    deps.preview.view.value = 'file'
    const actions = mountActions(deps)

    expect(actions.workspaceOpen.value).toBe(false)
    actions.onToggleWorkspace()

    expect(deps.preview.openList).toHaveBeenCalledTimes(1)
    expect(deps.workspace.load).toHaveBeenCalledTimes(1)
    expect(deps.preview.close).not.toHaveBeenCalled()
  })
})

describe('useChatHeaderActions —— 数字人面板', () => {
  it('打开才拉候选清单；已展开再打开不重复拉、也不关闭（幂等）', async () => {
    const deps = makeDeps()
    const actions = mountActions(deps)

    await actions.onOpenAgentPanel()
    expect(actions.agentPanelOpen.value).toBe(true)
    expect(deps.agents.loadCandidates).toHaveBeenCalledTimes(1)

    // 账号菜单再次选「切换数字人」：语义是打开，不得把面板关掉、也不重复拉清单
    await actions.onOpenAgentPanel()
    expect(actions.agentPanelOpen.value).toBe(true)
    expect(deps.agents.loadCandidates).toHaveBeenCalledTimes(1)

    actions.onCloseAgentPanel()
    expect(actions.agentPanelOpen.value).toBe(false)
  })

  it('切换成功才收起面板；切换失败保持展开便于重试（FR-037）', async () => {
    const deps = makeDeps()
    const actions = mountActions(deps)
    await actions.onOpenAgentPanel()

    await actions.onSwitchAgent('demo-a')
    expect(actions.agentPanelOpen.value).toBe(true)

    deps.agents.currentAgent.value = { agent_name: 'demo-b' }
    await actions.onSwitchAgent('demo-b')
    expect(actions.agentPanelOpen.value).toBe(false)
  })
})
