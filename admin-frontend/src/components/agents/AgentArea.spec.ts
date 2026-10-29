/**
 * 组件测试：数字人设计功能区的「新建」链路（`FR-015`，2026-10-09）。
 *
 * 守住的是**跨组件**的那条接缝：列表「新建数字人」→ 弹窗采集 → 确认 → 导航到设计明细，
 * 且弹窗填的名称被带进设计器草稿（`AgentArea` 的 `pendingNew` 传递）。
 * 单看 `AgentCardList` / `CreateAgentDialog` / `AgentDesigner` 各自的测试都盖不到这里。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentArea from './AgentArea.vue'
import type { AgentListItem, Paged } from '../../api/types'

const listAgents = vi.fn()
const getAgent = vi.fn()
const getAgentCatalog = vi.fn()

vi.mock('../../api/agents', () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  getAgent: (...args: unknown[]) => getAgent(...args),
  // 2026-10-17：候选清单一律走 §5.6 的全量端点，不再调卡片列表的 page=1
  getAgentCatalog: (...args: unknown[]) => getAgentCatalog(...args),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

vi.mock('../../api/http', () => ({
  http: {
    get: vi.fn().mockResolvedValue({ items: [] }),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
}))

function emptyPage(): Paged<AgentListItem> {
  return { items: [], total: 0, page: 1, page_size: 8, total_pages: 0 }
}

async function openCreateDialog(wrapper: ReturnType<typeof mount>) {
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '新建数字人')
    ?.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  listAgents.mockReset().mockResolvedValue(emptyPage())
  getAgent.mockReset()
  getAgentCatalog.mockReset().mockResolvedValue({
    builtin_tools: [],
    builtin_tools_error: null,
    mcp_services: [],
    skills: [],
    ontologies: [],
  })
})

describe('AgentArea —— 新建数字人链路（FR-015）', () => {
  it('点「新建数字人」先弹窗，MUST NOT 直接导航', async () => {
    const wrapper = mount(AgentArea, { props: { detail: null, tab: null } })
    await flushPromises()

    await openCreateDialog(wrapper)

    expect(wrapper.emitted('navigate')).toBeUndefined()
    expect(wrapper.find('[data-test="create-agent-dialog"]').attributes('open')).toBeDefined()
  })

  it('弹窗确认后导航到设计明细，且名称被预填进草稿', async () => {
    const wrapper = mount(AgentArea, { props: { detail: null, tab: null } })
    await flushPromises()
    await openCreateDialog(wrapper)

    await wrapper.find('[data-test="create-agent-name"]').setValue('新助手')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('navigate')?.[0]).toEqual(['/agents/__new__'])

    // 模拟父级（路由）把 detail 切到新建哨兵
    await wrapper.setProps({ detail: '__new__' })
    await flushPromises()

    expect((wrapper.find('#agent-name').element as HTMLInputElement).value).toBe('新助手')
  })

  it('弹窗取消：不导航、不进入设计明细', async () => {
    const wrapper = mount(AgentArea, { props: { detail: null, tab: null } })
    await flushPromises()
    await openCreateDialog(wrapper)

    await wrapper.find('[data-test="cancel"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('navigate')).toBeUndefined()
  })
})

describe('AgentArea —— 设计器候选目录（§5.6，2026-10-17）', () => {
  it('第 9 个 SKILL 也能出现在选择器里（候选不再被卡片页大小截断）', async () => {
    getAgentCatalog.mockResolvedValue({
      builtin_tools: [],
      builtin_tools_error: null,
      mcp_services: [],
      skills: Array.from({ length: 9 }, (_, index) => ({
        name: `skill-${index + 1}`,
        description: '',
        installed_at: '2026-10-17T00:00:00.000Z',
        updated_at: '2026-10-17T00:00:00.000Z',
        source: 'zip',
      })),
      ontologies: [],
    })

    const wrapper = mount(AgentArea, { props: { detail: '__new__', tab: 'skills' } })
    await flushPromises()

    expect(wrapper.text()).toContain('skill-9')
  })

  it('本体候选透传到「本体」页签：显示 `{场景名}-{本体名}`', async () => {
    getAgentCatalog.mockResolvedValue({
      builtin_tools: [],
      builtin_tools_error: null,
      mcp_services: [],
      skills: [],
      ontologies: [
        {
          metadata: {
            created_at: '2026-07-15 16:05:02',
            deployed_version: 'v1.0',
            scenario_name: '生产调度',
            scenario_id: 1,
            ontology_name: '原材料采购和库存',
            ontology_id: 1,
          },
        },
      ],
    })

    const wrapper = mount(AgentArea, { props: { detail: '__new__', tab: 'ontologies' } })
    await flushPromises()

    expect(wrapper.text()).toContain('生产调度-原材料采购和库存')
  })

  it('工具目录不可读 → 原因透传到设计器提示，MCP/SKILL 候选不受影响', async () => {
    getAgentCatalog.mockResolvedValue({
      builtin_tools: [],
      builtin_tools_error: '运行环境不可达（测试桩）',
      mcp_services: [
        {
          name: 'ocr',
          description: '',
          transport: 'http',
          url: null,
          has_headers: false,
          allowed_tools: [],
        },
      ],
      skills: [],
      ontologies: [],
    })

    const wrapper = mount(AgentArea, { props: { detail: '__new__', tab: 'tools' } })
    await flushPromises()

    expect(wrapper.text()).toContain('运行环境不可达（测试桩）')
  })
})
