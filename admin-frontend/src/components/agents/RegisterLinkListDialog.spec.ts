import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RegisterLinkListDialog from './RegisterLinkListDialog.vue'
import type { RegisterLinkItem } from '../../api/types'

const listRegisterLinks = vi.fn()
const revokeRegisterLink = vi.fn()

vi.mock('../../api/account', () => ({
  listRegisterLinks: (...args: unknown[]) => listRegisterLinks(...args),
  revokeRegisterLink: (...args: unknown[]) => revokeRegisterLink(...args),
  createRegisterLink: vi.fn(),
}))

function link(overrides: Partial<RegisterLinkItem> = {}): RegisterLinkItem {
  return {
    token: 'tok-active-1',
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

const ACTIVE = link()
const EXPIRED = link({
  token: 'tok-expired',
  expires_at: '2020-01-01 00:00:00',
  created_at: '2026-11-10 10:00:00',
})
const REVOKED = link({
  token: 'tok-revoked',
  revoked_at: '2026-11-21 09:00:00',
  created_at: '2026-11-09 10:00:00',
})

function mountDialog(serviceCode: string | null = 'DH-DEMO01') {
  return mount(RegisterLinkListDialog, {
    props: { open: true, agentName: 'demo', serviceCode },
  })
}

function confirmDialog(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="revoke-links-confirm"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  listRegisterLinks.mockResolvedValue({ items: [ACTIVE, EXPIRED, REVOKED] })
  revokeRegisterLink.mockResolvedValue(undefined)
})

describe('RegisterLinkListDialog —— 列出全部链接与状态', () => {
  it('按状态展示三条链接，只有有效链接可关闭', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(listRegisterLinks).toHaveBeenCalledWith('DH-DEMO01')
    const text = wrapper.text()
    expect(text).toContain('共 3 条')
    expect(text).toContain('有效')
    expect(text).toContain('已过期')
    expect(text).toContain('已撤销')
    expect(text).toContain('长期有效')

    const closeButtons = wrapper.findAll('button').filter((item) => item.text() === '关闭')
    // 表头外还有底部「关闭」，这里只取表格行内的三个
    const rowButtons = closeButtons.filter((item) => item.classes('btn--small'))
    expect(rowButtons).toHaveLength(3)
    expect((rowButtons[0]!.element as HTMLButtonElement).disabled).toBe(false)
    expect((rowButtons[1]!.element as HTMLButtonElement).disabled).toBe(true)
    expect((rowButtons[2]!.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('没有服务编码时不发请求（防御性早退）', async () => {
    mountDialog(null)
    await flushPromises()

    expect(listRegisterLinks).not.toHaveBeenCalled()
  })

  it('没有链接时给出空态', async () => {
    listRegisterLinks.mockResolvedValue({ items: [] })
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('还没有生成过注册链接')
  })
})

describe('RegisterLinkListDialog —— 逐条关闭', () => {
  it('点行内「关闭」先二次确认，确认后才撤销并刷新', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const rowButton = wrapper
      .findAll('button')
      .filter((item) => item.text() === '关闭' && item.classes('btn--small'))[0]!
    await rowButton.trigger('click')
    await flushPromises()

    const dialog = confirmDialog(wrapper)
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('关闭后立即无法再用于注册')
    expect(revokeRegisterLink).not.toHaveBeenCalled()

    await dialog.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(revokeRegisterLink).toHaveBeenCalledWith('tok-active-1')
    expect(listRegisterLinks).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('已关闭 1 条注册链接')
  })

  it('取消确认不撤销', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper
      .findAll('button')
      .filter((item) => item.text() === '关闭' && item.classes('btn--small'))[0]!
      .trigger('click')
    await flushPromises()
    await confirmDialog(wrapper).get('[data-test="cancel"]').trigger('click')
    await flushPromises()

    expect(revokeRegisterLink).not.toHaveBeenCalled()
  })
})

describe('RegisterLinkListDialog —— 一次性全部关闭', () => {
  it('只关闭仍有效的链接，确认提示条数，成功后播报', async () => {
    const second = link({ token: 'tok-active-2', created_at: '2026-11-22 10:00:00' })
    listRegisterLinks.mockResolvedValue({ items: [ACTIVE, second, REVOKED] })
    const wrapper = mountDialog()
    await flushPromises()

    const allButton = wrapper.findAll('button').find((item) => item.text() === '全部关闭')!
    await allButton.trigger('click')
    await flushPromises()

    const dialog = confirmDialog(wrapper)
    expect(dialog.text()).toContain('2 条有效注册链接')

    await dialog.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(revokeRegisterLink).toHaveBeenCalledTimes(2)
    expect(revokeRegisterLink).toHaveBeenCalledWith('tok-active-1')
    expect(revokeRegisterLink).toHaveBeenCalledWith('tok-active-2')
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('已关闭 2 条注册链接')
  })

  it('批量关闭中途失败：仍播报已关闭数、失败数一并提示，并刷新列表', async () => {
    const second = link({ token: 'tok-active-2', created_at: '2026-11-22 10:00:00' })
    listRegisterLinks.mockResolvedValue({ items: [ACTIVE, second] })
    revokeRegisterLink
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ code: 'INTERNAL_ERROR', message: 'boom' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.findAll('button').find((item) => item.text() === '全部关闭')!.trigger('click')
    await flushPromises()
    await confirmDialog(wrapper).get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    // 两条都尝试撤销；成功的 1 条照常播报，失败的 1 条计入并展示错误
    expect(revokeRegisterLink).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('已关闭 1 条注册链接')
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('另有 1 条关闭失败')
    // 结束后刷新列表，让前端状态与后端一致
    expect(listRegisterLinks).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.error-notice').exists()).toBe(true)
  })

  it('没有有效链接时「全部关闭」禁用', async () => {
    listRegisterLinks.mockResolvedValue({ items: [EXPIRED, REVOKED] })
    const wrapper = mountDialog()
    await flushPromises()

    const allButton = wrapper.findAll('button').find((item) => item.text() === '全部关闭')!
    expect((allButton.element as HTMLButtonElement).disabled).toBe(true)
  })
})
