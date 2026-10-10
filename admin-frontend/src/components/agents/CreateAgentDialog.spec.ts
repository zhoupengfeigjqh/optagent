/**
 * 组件测试：「新建数字人」弹窗（`FR-015`，2026-10-09）。
 *
 * 覆盖：名称必填与非法名拒绝、**重名拒绝**（不关窗、输入不丢）、
 * 复制源下拉（含异常源警示）、以及清单读不到时的降级口径（原则九）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CreateAgentDialog from './CreateAgentDialog.vue'
import type { AgentListItem, Paged } from '../../api/types'

const listAgents = vi.fn()

vi.mock('../../api/agents', () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  getAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

function item(name: string, abnormal = false): AgentListItem {
  return {
    name,
    description: '',
    abnormal,
    abnormal_reason: abnormal ? '内置工具「ghost」已失效' : null,
    updated_at: '2026-10-09T00:00:00.000Z',
  }
}

function pageOf(items: AgentListItem[], page: number, totalPages: number): Paged<AgentListItem> {
  return { items, total: totalPages * 8, page, page_size: 8, total_pages: totalPages }
}

async function mountDialog() {
  const wrapper = mount(CreateAgentDialog, { props: { open: true } })
  await flushPromises()
  return wrapper
}

function nameInput(wrapper: ReturnType<typeof mount>) {
  return (wrapper.find('[data-test="create-agent-name"]').element as HTMLInputElement).value
}

beforeEach(() => {
  // 默认：空库（无重名、无复制源）
  listAgents.mockReset().mockResolvedValue(pageOf([], 1, 0))
})

describe('CreateAgentDialog —— 名称必填与合法性（FR-015）', () => {
  it('名称为必填：留空确认即被拒绝，且不关窗', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.find('[data-test="create-agent-error"]').text()).toContain('必填')
  })

  it('非法名（含分隔符）被拒绝并说明原因', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="create-agent-name"]').setValue('a/b')
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.find('[data-test="create-agent-error"]').text()).toContain('名称非法')
  })
})

describe('CreateAgentDialog —— 重名拒绝（FR-015）', () => {
  it('与既有数字人重名：拒绝创建、不关窗、输入不丢', async () => {
    listAgents.mockResolvedValue(pageOf([item('生产计划助手')], 1, 1))
    const wrapper = await mountDialog()

    await wrapper.find('[data-test="create-agent-name"]').setValue('生产计划助手')
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
    expect(wrapper.emitted('update:open')).toBeUndefined()
    expect(wrapper.find('[data-test="create-agent-error"]').text()).toContain('数字人名称已存在')
    // 不关窗的意义就在这里：输入还在，改个名字即可继续
    expect(nameInput(wrapper)).toBe('生产计划助手')
  })

  it('重名判据基于**全量**清单：翻到第 2 页也算（只看首页会漏判）', async () => {
    listAgents.mockImplementation((page: number) =>
      Promise.resolve(
        page === 1 ? pageOf([item('a')], 1, 2) : pageOf([item('生产计划助手')], 2, 2),
      ),
    )
    const wrapper = await mountDialog()

    expect(listAgents).toHaveBeenCalledWith(2)
    await wrapper.find('[data-test="create-agent-name"]').setValue('生产计划助手')
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})

describe('CreateAgentDialog —— 复制已有数字人', () => {
  it('不选复制源：发出新名称与 copyFrom=null（名称按 trim 提交）', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="create-agent-name"]').setValue('  新助手  ')
    await wrapper.find('[data-test="confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ name: '新助手', copyFrom: null }])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('选择复制源：发出该名称；选异常源时给出失效警示但**仍允许**复制', async () => {
    listAgents.mockResolvedValue(pageOf([item('demo'), item('broken', true)], 1, 1))
    const wrapper = await mountDialog()

    await wrapper.find('[data-test="create-agent-name"]').setValue('副本')
    await wrapper.find('[data-test="create-agent-copy-from"]').setValue('broken')

    expect(wrapper.text()).toContain('部分引用已失效')

    await wrapper.find('[data-test="confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ name: '副本', copyFrom: 'broken' }])
  })
})

describe('CreateAgentDialog —— 降级与关闭', () => {
  it('清单读取失败：不本地判重名（改由服务端拒绝）并如实提示，不阻断新建', async () => {
    listAgents.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'raw backend msg' })
    const wrapper = await mountDialog()

    expect(wrapper.text()).toContain('未能读取已有数字人清单')
    expect(wrapper.text()).not.toContain('raw backend msg')
    expect(wrapper.find('[data-test="create-agent-copy-from"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-test="create-agent-name"]').setValue('任意名')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ name: '任意名', copyFrom: null }])
  })

  it('取消：发出 update:open=false 且不发 confirm', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="cancel"]').trigger('click')

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
