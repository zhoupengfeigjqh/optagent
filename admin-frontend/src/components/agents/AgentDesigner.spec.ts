/**
 * 组件测试：数字人设计器（T059）
 *
 * 覆盖 `FR-016`（五类配置以分区承载）、`FR-017`（保存后回显）、
 * `FR-015`（保存失败可读）与"未保存修改需确认"。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AgentDesigner from './AgentDesigner.vue'
import { NEW_AGENT_SENTINEL } from '../../constants/agent-design'
import type { AgentDesign } from '../../api/types'

const createAgent = vi.fn()
const updateAgent = vi.fn()
const getAgent = vi.fn()
const deleteAgent = vi.fn()

vi.mock('../../api/agents', () => ({
  createAgent: (...args: unknown[]) => createAgent(...args),
  updateAgent: (...args: unknown[]) => updateAgent(...args),
  getAgent: (...args: unknown[]) => getAgent(...args),
  listAgents: vi.fn(),
  deleteAgent: (...args: unknown[]) => deleteAgent(...args),
}))

const DESIGN: AgentDesign = {
  name: 'demo',
  soul: '你是助手',
  enabled_tools: [],
  mcp_services: [],
  skills: [],
  scenario: {
    scenario: '生产',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: { 生产计划: [{ name: '产线编号', type: 'string', required: true }] },
  },
  abnormal: false,
  abnormal_reason: null,
  updated_at: '2026-09-15T00:00:00.000Z',
  revision: 3,
}

function mountDesigner(name = NEW_AGENT_SENTINEL, design: AgentDesign | null = null) {
  return mount(AgentDesigner, {
    props: {
      name,
      design,
      builtinTools: [],
      builtinToolsError: null,
      mcpServices: [],
      skills: [],
      initialTab: null,
    },
  })
}

beforeEach(() => {
  createAgent.mockReset()
  updateAgent.mockReset()
  getAgent.mockReset()
  deleteAgent.mockReset()
})

describe('AgentDesigner', () => {
  it('五类配置以分区（页签）承载，导航深度不超过两级（FR-016、FR-053）', () => {
    const wrapper = mountDesigner()
    const tabs = wrapper.findAll('[role="tab"]').map((t) => t.text())
    expect(tabs).toEqual(['SOUL', '内置工具', 'MCP 服务', 'SKILL', '文件空间场景'])
  })

  it('新建时标题为「新建数字人」，编辑时为设计态标题', async () => {
    expect(mountDesigner().text()).toContain('新建数字人')

    getAgent.mockResolvedValue(DESIGN)
    const editing = mountDesigner('demo')
    await flushPromises()
    expect(editing.text()).toContain('设计数字人：demo')
  })

  it('名称为必填项且标注为必填', () => {
    const wrapper = mountDesigner()
    expect(wrapper.text()).toContain('数字人名称')
    expect(wrapper.find('#agent-name').attributes('aria-required')).toBeUndefined()
    expect(wrapper.find('.field__required').exists()).toBe(true)
  })

  it('保存成功发出 saved 事件（FR-017）', async () => {
    createAgent.mockResolvedValue({ ...DESIGN, name: '新数字人' })
    const wrapper = mountDesigner()

    await wrapper.find('#agent-name').setValue('新数字人')
    await wrapper.findAll('[role="tab"]')[0]?.trigger('click')
    const save = wrapper.findAll('button').find((b) => b.text().includes('保存'))
    await save?.trigger('click')
    await flushPromises()

    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ name: '新数字人' })
  })

  it('保存失败：发出 error 且错误按码给出可读文案（不展示后端 message）', async () => {
    createAgent.mockRejectedValue({ code: 'ADM_AGENT_NAME_TAKEN', message: 'raw backend msg' })
    const wrapper = mountDesigner()

    await wrapper.find('#agent-name').setValue('demo')
    const save = wrapper.findAll('button').find((b) => b.text().includes('保存'))
    await save?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('ADM_AGENT_NAME_TAKEN')
    expect(wrapper.find('[role="alert"]').text()).toContain('数字人名称已存在或非法')
    expect(wrapper.text()).not.toContain('raw backend msg')
  })

  it('有未保存修改时返回需二次确认（不静默丢弃）', async () => {
    const wrapper = mountDesigner()
    await wrapper.find('#agent-name').setValue('改过的名字')

    const back = wrapper.findAll('button').find((b) => b.text().includes('返回列表'))
    await back?.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('back')).toBeUndefined()
    const dialog = wrapper.find('dialog')
    expect(dialog.text()).toContain('放弃未保存的修改')
  })

  it('无修改时返回直接生效', async () => {
    const wrapper = mountDesigner()
    const back = wrapper.findAll('button').find((b) => b.text().includes('返回列表'))
    await back?.trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })

  it('内置工具目录不可读时给出前置提示（避免把有效引用误判为失效）', () => {
    const wrapper = mount(AgentDesigner, {
      props: {
        name: NEW_AGENT_SENTINEL,
        design: null,
        builtinTools: [],
        builtinToolsError: { code: 'ADM_RUNTIME_UNREACHABLE', message: 'x' },
        mcpServices: [],
        skills: [],
        initialTab: 'tools',
      },
    })
    expect(wrapper.text()).toContain('内置工具目录不可读')
  })
})

describe('AgentDesigner —— 删除数字人（2026-09-16）', () => {
  it('编辑已有数字人：标题栏「保存」左侧有红色删除入口；新建态没有', async () => {
    getAgent.mockResolvedValue(DESIGN)
    const editing = mountDesigner('demo')
    await flushPromises()

    const headerButtons = editing.find('.agent-designer__header').findAll('button')
    expect(headerButtons.map((b) => b.text())).toEqual(['← 返回列表', '删除', '保存'])
    expect(headerButtons[1]?.classes()).toContain('btn--danger')

    // 新建态没有可删除的对象：标题栏里只有返回与保存（确认弹窗的按钮不算入口）
    const newHeader = mountDesigner().find('.agent-designer__header')
    expect(newHeader.findAll('button').map((b) => b.text())).toEqual(['← 返回列表', '保存'])
  })

  it('删除需二次确认，并明确提示"无法恢复"（确认前不调接口）', async () => {
    getAgent.mockResolvedValue(DESIGN)
    const wrapper = mountDesigner('demo')
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '删除')?.trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-test="agent-delete-dialog"]')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('无法恢复')
    expect(deleteAgent).not.toHaveBeenCalled()
  })

  it('确认后删除并发出 deleted（父组件据此退回列表）', async () => {
    getAgent.mockResolvedValue(DESIGN)
    deleteAgent.mockResolvedValue(undefined)
    const wrapper = mountDesigner('demo')
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '删除')?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="agent-delete-dialog"] [data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(deleteAgent).toHaveBeenCalledWith('demo')
    expect(wrapper.emitted('deleted')?.[0]).toEqual(['demo'])
  })

  it('被用户关联时服务端拒绝（FR-021）：给出可读原因、不发 deleted', async () => {
    getAgent.mockResolvedValue(DESIGN)
    deleteAgent.mockRejectedValue({ code: 'AGENT_IN_USE', message: 'raw backend msg' })
    const wrapper = mountDesigner('demo')
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '删除')?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="agent-delete-dialog"] [data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('deleted')).toBeUndefined()
    expect(wrapper.emitted('error')?.[0]?.[0]).toContain('AGENT_IN_USE')
  })
})
