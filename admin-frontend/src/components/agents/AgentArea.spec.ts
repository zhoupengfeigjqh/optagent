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
const listBuiltinTools = vi.fn()
const httpGet = vi.fn()

vi.mock('../../api/agents', () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  getAgent: (...args: unknown[]) => getAgent(...args),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

vi.mock('../../api/builtin-tools', () => ({
  listBuiltinTools: (...args: unknown[]) => listBuiltinTools(...args),
}))

vi.mock('../../api/http', () => ({
  http: {
    get: (...args: unknown[]) => httpGet(...args),
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
  listBuiltinTools.mockReset().mockResolvedValue({ items: [] })
  httpGet.mockReset().mockResolvedValue(emptyPage())
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
