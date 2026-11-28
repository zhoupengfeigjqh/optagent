import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterManagementDialog from './RegisterManagementDialog.vue'
import type { AgentListItem, AgentServiceItem, RegisterLinkItem } from '../../api/types'

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

function linkItem(overrides: Partial<RegisterLinkItem> = {}): RegisterLinkItem {
  return {
    token: 'tok-existing',
    agent_code: 'DH-DEMO01',
    agent_name: '演示服务',
    expires_at: null,
    revoked_at: null,
    use_count: 0,
    created_by: null,
    created_at: '2026-11-20 10:00:00',
    ...overrides,
  }
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

describe('RegisterManagementDialog —— 打开复用有效链接（2026-11-28）', () => {
  it('已有有效链接：打开即展示，不发生成请求', async () => {
    listRegisterLinks.mockResolvedValue({ items: [linkItem()] })
    const wrapper = mountDialog()
    await flushPromises()

    expect(listRegisterLinks).toHaveBeenCalledWith('DH-DEMO01')
    expect(createRegisterLink).not.toHaveBeenCalled()
    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('http://localhost:5173/register?link=tok-existing')
    expect(wrapper.text()).toContain('已有有效链接')
    expect(wrapper.text()).toContain('无需重新生成')
    expect(button(wrapper, '重新生成')).toBeTruthy()
  })

  it('多条有效链接取最新一条；已撤销/已过期的不算', async () => {
    listRegisterLinks.mockResolvedValue({
      items: [
        linkItem({ token: 'tok-old', created_at: '2026-11-10 10:00:00' }),
        linkItem({ token: 'tok-new', created_at: '2026-11-25 10:00:00' }),
        linkItem({ token: 'tok-revoked', revoked_at: '2026-11-26 10:00:00' }),
        linkItem({ token: 'tok-expired', expires_at: '2020-01-01 00:00:00' }),
      ],
    })
    const wrapper = mountDialog()
    await flushPromises()

    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('http://localhost:5173/register?link=tok-new')
  })

  it('全部链接都已失效：空态并提示生成', async () => {
    listRegisterLinks.mockResolvedValue({
      items: [linkItem({ revoked_at: '2026-11-26 10:00:00' })],
    })
    const wrapper = mountDialog()
    await flushPromises()

    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('')
    expect(input.element.placeholder).toContain('当前没有有效链接')
    expect(button(wrapper, '生成链接')).toBeTruthy()
  })

  it('无有效链接时「生成链接」仍按 7 天生成并可复制', async () => {
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

  it('读取既有链接失败不报生成错误，仍可手动生成', async () => {
    listRegisterLinks.mockRejectedValue({ code: 'NETWORK', message: '网络异常' })
    const wrapper = mountDialog()
    await flushPromises()

    expect(createRegisterLink).not.toHaveBeenCalled()
    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.placeholder).toContain('未能读取已有链接')
    expect((button(wrapper, '生成链接')!.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('改选 30 天后「重新生成」用新有效期（已有链接场景）', async () => {
    listRegisterLinks.mockResolvedValue({ items: [linkItem()] })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.register-mgmt__ttl').setValue('30d')
    await button(wrapper, '重新生成')!.trigger('click')
    await flushPromises()

    expect(createRegisterLink).toHaveBeenLastCalledWith('DH-DEMO01', 30 * 86_400)
    const input = wrapper.find<HTMLInputElement>('.register-mgmt__link-input')
    expect(input.element.value).toBe('http://localhost:5173/register?link=token-1')
  })

  it('复制入口只剩底部「复制链接」（行内重复的「复制」已删）', async () => {
    listRegisterLinks.mockResolvedValue({ items: [linkItem()] })
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.findAll('button').filter((item) => item.text() === '复制')).toHaveLength(0)
    expect(wrapper.findAll('button').filter((item) => item.text() === '复制链接')).toHaveLength(1)
  })

  it('未配置服务：不发请求、给出原因，生成与停止都禁用', async () => {
    const wrapper = mountDialog(null)
    await flushPromises()

    expect(listRegisterLinks).not.toHaveBeenCalled()
    expect(createRegisterLink).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('尚未配置注册服务')
    expect((button(wrapper, '生成链接')!.element as HTMLButtonElement).disabled).toBe(true)
    expect((button(wrapper, '停止注册')!.element as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('RegisterManagementDialog —— 停止注册入口', () => {
  it('点「停止注册」打开链接列表弹窗，并加载该编码的链接', async () => {
    listRegisterLinks.mockResolvedValue({ items: [linkItem({ token: 'tok-1' })] })
    const wrapper = mountDialog()
    await flushPromises()

    await button(wrapper, '停止注册')!.trigger('click')
    await flushPromises()

    expect(listRegisterLinks).toHaveBeenCalledWith('DH-DEMO01')
    expect(wrapper.text()).toContain('停止注册')
    expect(wrapper.text()).toContain('有效')
  })

  it('从「停止注册」返回后重新读取：链接已被关闭则不再展示', async () => {
    listRegisterLinks.mockResolvedValueOnce({ items: [linkItem()] })
    listRegisterLinks.mockResolvedValue({
      items: [linkItem({ revoked_at: '2026-11-27 10:00:00' })],
    })
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.find<HTMLInputElement>('.register-mgmt__link-input').element.value).not.toBe('')

    await button(wrapper, '停止注册')!.trigger('click')
    await flushPromises()

    const closeButton = wrapper
      .findAll('button')
      .filter((item) => item.text() === '关闭')
      .at(-1)!
    await closeButton.trigger('click')
    await flushPromises()

    expect(wrapper.find<HTMLInputElement>('.register-mgmt__link-input').element.value).toBe('')
  })

  it('右上角关闭按钮关闭主弹窗', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await wrapper.get('.base-dialog__close').trigger('click')
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })
})
