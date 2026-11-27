import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterLinkDialog from './RegisterLinkDialog.vue'
import type { AgentListItem, AgentServiceItem } from '../../api/types'

const createRegisterLink = vi.fn()
const copyToClipboard = vi.fn()

vi.mock('../../api/account', () => ({
  createRegisterLink: (...args: unknown[]) => createRegisterLink(...args),
}))

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...args),
}))

const AGENT: AgentListItem = {
  name: 'demo',
  description: '演示数字人',
  abnormal: false,
  abnormal_reason: null,
  updated_at: '2026-11-24T10:00:00.000Z',
}

const SERVICE: AgentServiceItem = {
  code: 'DH-DEMO01',
  name: '演示服务',
  platform_agent_name: 'demo',
  status: 'enabled',
  registered_users: 3,
  created_at: '2026-11-24 10:00:00',
  updated_at: '2026-11-24 10:00:00',
}

beforeEach(() => {
  vi.clearAllMocks()
  createRegisterLink.mockResolvedValue({
    token: 'token-1',
    url: '/register?link=token-1',
    agent_code: 'DH-DEMO01',
    expires_at: '2026-12-01 10:00:00',
  })
  copyToClipboard.mockResolvedValue(true)
})

describe('RegisterLinkDialog', () => {
  it('打开时生成默认 7 天链接并复制前台注册地址', async () => {
    const wrapper = mount(RegisterLinkDialog, {
      props: { open: true, agent: AGENT, service: SERVICE },
    })
    await flushPromises()

    expect(createRegisterLink).toHaveBeenCalledWith('DH-DEMO01', 7 * 86_400)
    const input = wrapper.find<HTMLInputElement>('.register-link-dialog__link-input')
    expect(input.element.value).toBe('http://localhost:5173/register?link=token-1')

    await wrapper
      .findAll('button')
      .find((item) => item.text() === '复制链接')
      ?.trigger('click')
    await flushPromises()
    expect(copyToClipboard).toHaveBeenCalledWith(input.element.value)
  })

  it('可改选 30 天后重新生成', async () => {
    const wrapper = mount(RegisterLinkDialog, {
      props: { open: true, agent: AGENT, service: SERVICE },
    })
    await flushPromises()
    await wrapper.find('.register-link-dialog__ttl').setValue('30d')
    await wrapper
      .findAll('button')
      .find((item) => item.text() === '重新生成')
      ?.trigger('click')
    await flushPromises()
    expect(createRegisterLink).toHaveBeenLastCalledWith('DH-DEMO01', 30 * 86_400)
  })

  it('未配置服务时不发请求并提示原因', async () => {
    const wrapper = mount(RegisterLinkDialog, {
      props: { open: true, agent: AGENT, service: null },
    })
    await flushPromises()
    expect(createRegisterLink).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('尚未配置注册服务')
  })

  it('右上角关闭按钮关闭弹窗', async () => {
    const wrapper = mount(RegisterLinkDialog, {
      props: { open: true, agent: AGENT, service: SERVICE },
    })
    await flushPromises()
    await wrapper.get('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})
