/**
 * 组件测试：用户编辑器（2026-11-10 由内联 section 改为弹窗）。
 *
 * 覆盖：弹窗形态（原生 `<dialog>` + Esc）、新建/编辑两态的内容差异、
 * 已关联数字人预勾选、保存/取消的事件与载荷、保存中态。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AgentListItem, UserListItem } from '../../api/types'
import UserEditor from './UserEditor.vue'

const AGENTS: AgentListItem[] = [
  {
    name: 'demo',
    description: '演示数字人',
    abnormal: false,
    abnormal_reason: null,
    updated_at: '2026-10-01T00:00:00.000Z',
  },
  {
    name: 'extra',
    description: '',
    abnormal: true,
    abnormal_reason: '引用的 SKILL 已失效',
    updated_at: '2026-10-01T00:00:00.000Z',
  },
]

const ADMIN: UserListItem = {
  user_id: 'admin',
  agents: [{ name: 'demo', abnormal: false, abnormal_reason: null }],
  deployed_at: null,
  summary: null,
}

function mountEditor(open: boolean, user: UserListItem | null = null) {
  return mount(UserEditor, { props: { open, user, agents: AGENTS } })
}

function buttonByText(wrapper: ReturnType<typeof mountEditor>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

describe('UserEditor —— 弹窗形态', () => {
  it('未打开时不带 open 属性，且不渲染表单内容', () => {
    const wrapper = mountEditor(false)
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.find('#user-id').exists()).toBe(false)
  })

  it('打开后是原生 dialog，标题为「编辑用户：admin」', async () => {
    const wrapper = mountEditor(true, ADMIN)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.find('h2').text()).toBe('编辑用户：admin')
  })

  it('Esc（cancel 事件）关闭弹窗并回写 update:open=false', async () => {
    const wrapper = mountEditor(true, ADMIN)
    const event = new Event('cancel', { cancelable: true })
    await wrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})

describe('UserEditor —— 内容与事件', () => {
  it('编辑态：不展示用户标识输入框（不可改），已关联的数字人预勾选', () => {
    const wrapper = mountEditor(true, ADMIN)
    expect(wrapper.find('#user-id').exists()).toBe(false)
    expect(wrapper.text()).toContain('用户标识不可修改')

    const demoItem = wrapper
      .findAll('.checkbox-list__item')
      .find((li) => li.text().includes('demo'))
    expect((demoItem!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      true,
    )

    const extraItem = wrapper
      .findAll('.checkbox-list__item')
      .find((li) => li.text().includes('extra'))
    expect((extraItem!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      false,
    )
  })

  it('新建态：展示用户标识输入框，保存时带上输入值与勾选的数字人', async () => {
    const wrapper = mountEditor(true, null)
    expect(wrapper.find('h2').text()).toBe('新建用户')

    await wrapper.find('#user-id').setValue('alice')
    const extraItem = wrapper
      .findAll('.checkbox-list__item')
      .find((li) => li.text().includes('extra'))
    await extraItem!.find('input[type="checkbox"]').setValue(true)

    await buttonByText(wrapper, '保存')!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]).toEqual([{ user_id: 'alice', agents: ['extra'] }])
  })

  it('取消：回写 update:open=false，不发出 submit', async () => {
    const wrapper = mountEditor(true, ADMIN)
    await buttonByText(wrapper, '取消')!.trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('保存中：按钮文案变为「保存中…」且禁用', () => {
    const wrapper = mount(UserEditor, {
      props: { open: true, user: ADMIN, agents: AGENTS, busy: true },
    })
    const save = buttonByText(wrapper, '保存中…')
    expect(save).toBeDefined()
    expect((save!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('重新打开时按最新的 user 重置勾选（不残留上一次的选择）', async () => {
    const wrapper = mountEditor(true, ADMIN)
    const extraItem = wrapper
      .findAll('.checkbox-list__item')
      .find((li) => li.text().includes('extra'))
    await extraItem!.find('input[type="checkbox"]').setValue(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    const reopened = wrapper
      .findAll('.checkbox-list__item')
      .find((li) => li.text().includes('extra'))
    expect((reopened!.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(
      false,
    )
  })
})
