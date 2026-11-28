import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AgentListItem } from '../../api/types'
import UserEditor from './UserEditor.vue'

const AGENTS: AgentListItem[] = [
  {
    name: 'demo',
    code: null,
    description: '演示数字人',
    abnormal: false,
    abnormal_reason: null,
    updated_at: '2026-10-01T00:00:00.000Z',
  },
  {
    name: 'extra',
    code: null,
    description: '',
    abnormal: true,
    abnormal_reason: '引用的 SKILL 已失效',
    updated_at: '2026-10-01T00:00:00.000Z',
  },
]

function mountEditor(open: boolean) {
  return mount(UserEditor, { props: { open, agents: AGENTS } })
}

function buttonByText(wrapper: ReturnType<typeof mountEditor>, text: string) {
  return wrapper.findAll('button').find((b) => b.text() === text)
}

function checkboxOf(wrapper: ReturnType<typeof mountEditor>, name: string) {
  return wrapper
    .findAll('.checkbox-list__item')
    .find((li) => li.text().includes(name))!
    .find('input[type="checkbox"]')
}

describe('UserEditor —— 弹窗形态（仅新建）', () => {
  it('未打开时不带 open 属性，且不渲染表单内容', () => {
    const wrapper = mountEditor(false)
    expect(wrapper.find('dialog').attributes('open')).toBeUndefined()
    expect(wrapper.find('#user-id').exists()).toBe(false)
  })

  it('打开后是原生 dialog，标题固定为「新建用户」', async () => {
    const wrapper = mountEditor(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('dialog').attributes('open')).toBeDefined()
    expect(wrapper.find('h2').text()).toBe('新建用户')
  })

  it('Esc（cancel 事件）关闭弹窗并回写 update:open=false', async () => {
    const wrapper = mountEditor(true)
    const event = new Event('cancel', { cancelable: true })
    await wrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})

describe('UserEditor —— 内容与事件', () => {
  it('新建态：展示用户标识与初始密码输入框，保存时带上输入值、勾选的数字人与密码', async () => {
    const wrapper = mountEditor(true)

    await wrapper.find('#user-id').setValue('alice')
    await wrapper.find('#user-password').setValue('123456')
    await checkboxOf(wrapper, 'extra').setValue(true)

    await buttonByText(wrapper, '保存')!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      // 新建态恒带 role（默认 user）；phone/display_name 留空则不带
      { user_id: 'alice', agents: ['extra'], password: '123456', role: 'user' },
    ])
  })

  it('初始密码过短 → 不发出 submit（并提示）', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('alice')
    await wrapper.find('#user-password').setValue('123')

    await buttonByText(wrapper, '保存')!.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('密码长度须为 6~128 个字符')
  })

  it('取消：回写 update:open=false，不发出 submit', async () => {
    const wrapper = mountEditor(true)
    await buttonByText(wrapper, '取消')!.trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('保存中：按钮文案变为「保存中…」且禁用', () => {
    const wrapper = mount(UserEditor, { props: { open: true, agents: AGENTS, busy: true } })
    const save = buttonByText(wrapper, '保存中…')
    expect(save).toBeDefined()
    expect((save!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('重新打开时清空上一次的输入（不残留勾选与密码）', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('alice')
    await wrapper.find('#user-password').setValue('123456')
    await checkboxOf(wrapper, 'extra').setValue(true)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect((wrapper.find('#user-id').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('#user-password').element as HTMLInputElement).value).toBe('')
    expect((checkboxOf(wrapper, 'extra').element as HTMLInputElement).checked).toBe(false)
  })
})

describe('UserEditor —— 028 账号扩展字段', () => {
  it('提供手机号/用户名/角色输入；手机号非法时就地报错且不发 submit', async () => {
    const wrapper = mountEditor(true)
    expect(wrapper.find('#user-phone').exists()).toBe(true)
    expect(wrapper.find('#user-display-name').exists()).toBe(true)
    expect(wrapper.find('#user-role').exists()).toBe(true)

    await wrapper.find('#user-id').setValue('ops2')
    await wrapper.find('#user-password').setValue('123456')
    await wrapper.find('#user-phone').setValue('123')
    await buttonByText(wrapper, '保存')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('手机号须为 1 开头的 11 位数字')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('手机号留空 + 合法输入 → submit 载荷含账号扩展字段', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('ops2')
    await wrapper.find('#user-password').setValue('123456')
    await wrapper.find('#user-display-name').setValue('张三')
    await buttonByText(wrapper, '保存')!.trigger('click')
    expect(wrapper.emitted('submit')?.[0]).toEqual([
      { user_id: 'ops2', agents: [], password: '123456', display_name: '张三', role: 'user' },
    ])
  })
})

describe('UserEditor —— 用户标识校验（与后端 isSafeName 同口径）', () => {
  it('用户标识留空 → 就地报错且不发 submit', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('')
    await buttonByText(wrapper, '保存')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('用户标识必填')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('含路径分隔符 → 就地报错且不发 submit', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('a/b')
    await buttonByText(wrapper, '保存')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('用户标识不得含路径分隔符')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('含 ".." → 就地报错且不发 submit', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('a..b')
    await buttonByText(wrapper, '保存')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('用户标识不得含 ".."')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('超过 64 字符 → 就地报错且不发 submit', async () => {
    const wrapper = mountEditor(true)
    await wrapper.find('#user-id').setValue('x'.repeat(65))
    await buttonByText(wrapper, '保存')!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('用户标识最长 64 个字符')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
