import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterManagementDialog from './RegisterManagementDialog.vue'
import type { AgentListItem, AgentServiceItem } from '../../api/types'

const createRegisterLink = vi.fn()
const listRegisterLinks = vi.fn()
const copyToClipboard = vi.fn()

vi.mock('../../api/account', () => ({
  createRegisterLink: (...args: unknown[]) => createRegisterLink(...args),
  listRegisterLinks: (...args: unknown[]) => listRegisterLinks(...args),
  revokeRegisterLink: vi.fn(),
}))

vi.mock('../../utils/clipboard', () => ({
  copyToClipboard: (...args: unknown[]) => copyToClipboard(...args),
}))

const AGENT: AgentListItem = {
  name: 'demo',
  code: 'DH-DEMO01',
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

function mountDialog(service: AgentServiceItem | null = SERVICE) {
  return mount(RegisterManagementDialog, {
    props: { open: true, agent: AGENT, service },
  })
}

function button(wrapper: ReturnType<typeof mountDialog>, text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)
}

beforeEach(() => {
  vi.clearAllMocks()
  createRegisterLink.mockResolvedValue({
    token: 'token-1',
    url: '/register?link=token-1',
    agent_code: 'DH-DEMO01',
    expires_at: '2026-12-01 10:00:00',
  })
  listRegisterLinks.mockResolvedValue({ items: [] })
  copyToClipboard.mockResolvedValue(true)
})

describe('RegisterManagementDialog —— 打开不自动生成（2026-11-27）', () => {
  it('打开弹窗不发生成请求，输入框为空占位', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(createRegisterLink).not.toHaveBeenCalled()
    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('')
    expect(wrapper.text()).toContain('不会自动生成链接')
  })

  it('点「生成链接」才按默认 7 天生成；生成后可复制', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await button(wrapper, '生成链接')!.trigger('click')
    await flushPromises()

    expect(createRegisterLink).toHaveBeenCalledWith('DH-DEMO01', 7 * 86_400)
    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('http://localhost:5173/register?link=token-1')

    await button(wrapper, '复制链接')!.trigger('click')
    await flushPromises()
    expect(copyToClipboard).toHaveBeenCalledWith(input.element.value)
  })

  it('改选 30 天后「重新生成」用新有效期', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await button(wrapper, '生成链接')!.trigger('click')
    await flushPromises()

    await wrapper.find('.register-mgmt__ttl').setValue('30d')
    await button(wrapper, '重新生成')!.trigger('click')
    await flushPromises()

    expect(createRegisterLink).toHaveBeenLastCalledWith('DH-DEMO01', 30 * 86_400)
  })

  it('复制入口只剩底部「复制链接」（行内重复的「复制」已删）', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await button(wrapper, '生成链接')!.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('button').filter((item) => item.text() === '复制')).toHaveLength(0)
    expect(wrapper.findAll('button').filter((item) => item.text() === '复制链接')).toHaveLength(1)
  })

  it('未配置服务：不发请求、给出原因，生成与停止都禁用', async () => {
    const wrapper = mountDialog(null)
    await flushPromises()

    expect(createRegisterLink).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('尚未配置注册服务')
    expect((button(wrapper, '生成链接')!.element as HTMLButtonElement).disabled).toBe(true)
    expect((button(wrapper, '停止注册')!.element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('RegisterManagementDialog —— 停止注册入口', () => {
  it('点「停止注册」打开链接列表弹窗，并加载该编码的链接', async () => {
    listRegisterLinks.mockResolvedValue({
      items: [
        {
          token: 'tok-1',
          agent_code: 'DH-DEMO01',
          agent_name: '演示服务',
          expires_at: null,
          revoked_at: null,
          use_count: 0,
          created_by: null,
          created_at: '2026-11-20 10:00:00',
        },
      ],
    })
    const wrapper = mountDialog()
    await flushPromises()

    await button(wrapper, '停止注册')!.trigger('click')
    await flushPromises()

    expect(listRegisterLinks).toHaveBeenCalledWith('DH-DEMO01')
    expect(wrapper.text()).toContain('停止注册')
    expect(wrapper.text()).toContain('有效')
  })

  it('右上角关闭按钮关闭主弹窗', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})
