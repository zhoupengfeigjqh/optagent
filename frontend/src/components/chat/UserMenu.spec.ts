import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import UserMenu from './UserMenu.vue'

/**
 * 登录态桩：`UserMenu` 只读 `currentUser`、只调 `logout`。
 * 用普通对象承载 `value`（而非 `ref`）是因为 `vi.hoisted` 先于 import 执行；
 * 组件内的 `computed` 在渲染时取值，静态值足以覆盖本组用例。
 */
const auth = vi.hoisted(() => ({
  currentUser: { value: null as { user_id: string } | null },
  logout: vi.fn(async (): Promise<void> => undefined),
}))

vi.mock('../../composables/useAuth', () => ({ getAuthStore: () => auth }))

const BaseDialogStub = {
  props: ['open', 'title'],
  template: '<div v-if="open" class="dialog-stub"><slot /><slot name="footer" /></div>',
}

function mountMenu() {
  return mount(UserMenu, { global: { stubs: { BaseDialog: BaseDialogStub } } })
}

async function openMenu(wrapper: ReturnType<typeof mountMenu>): Promise<void> {
  await wrapper.get('.base-dropdown__trigger').trigger('click')
}

function itemButtons(wrapper: ReturnType<typeof mountMenu>) {
  return wrapper.findAll('.base-dropdown__item')
}

function footerButton(wrapper: ReturnType<typeof mountMenu>, label: string) {
  const button = wrapper
    .findAll('button')
    .find((item) => item.text().trim() === label && !item.classes().includes('base-dropdown__item'))
  if (!button) throw new Error(`未找到按钮：${label}`)
  return button
}

describe('UserMenu —— 触发器与菜单', () => {
  beforeEach(() => {
    auth.currentUser.value = { user_id: 'admin' }
    auth.logout.mockClear()
    auth.logout.mockImplementation(async (): Promise<void> => undefined)
  })

  it('触发器显示当前登录用户名，并带读屏可读的「账号菜单」前缀', () => {
    const wrapper = mountMenu()

    const trigger = wrapper.get('.base-dropdown__trigger')
    expect(trigger.text()).toContain('账号菜单')
    expect(trigger.text()).toContain('admin')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('登录态缺省时回落到「未登录」，不渲染空按钮', () => {
    auth.currentUser.value = null
    const wrapper = mountMenu()

    expect(wrapper.get('.base-dropdown__trigger').text()).toContain('未登录')
  })

  it('点开只有两项：「切换数字人」「退出登录」', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)

    expect(itemButtons(wrapper).map((item) => item.text().trim())).toEqual([
      '切换数字人',
      '退出登录',
    ])
  })

  it('选「切换数字人」→ 发出 open-agent 并收起菜单，不触发登出', async () => {
    const wrapper = mountMenu()
    await openMenu(wrapper)

    await itemButtons(wrapper)[0]!.trigger('click')

    expect(wrapper.emitted('open-agent')).toHaveLength(1)
    expect(wrapper.find('.base-dropdown__menu').exists()).toBe(false)
    expect(auth.logout).not.toHaveBeenCalled()
    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })
})

describe('UserMenu —— 退出登录二次确认', () => {
  beforeEach(() => {
    auth.currentUser.value = { user_id: 'admin' }
    auth.logout.mockClear()
    auth.logout.mockImplementation(async (): Promise<void> => undefined)
  })

  async function openLogoutConfirm() {
    const wrapper = mountMenu()
    await openMenu(wrapper)
    await itemButtons(wrapper)[1]!.trigger('click')
    return wrapper
  }

  it('选「退出登录」→ 先弹确认框，确认前不调用登出', async () => {
    const wrapper = await openLogoutConfirm()

    expect(wrapper.find('.dialog-stub').exists()).toBe(true)
    expect(wrapper.get('.dialog-stub').text()).toContain('确认退出')
    expect(auth.logout).not.toHaveBeenCalled()
  })

  it('取消 → 关闭确认框，不登出', async () => {
    const wrapper = await openLogoutConfirm()

    await footerButton(wrapper, '取消').trigger('click')

    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
    expect(auth.logout).not.toHaveBeenCalled()
  })

  it('确认 → 调用一次登出，并关闭确认框', async () => {
    const wrapper = await openLogoutConfirm()

    await footerButton(wrapper, '退出登录').trigger('click')
    await flushPromises()

    expect(auth.logout).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })

  it('请求在途期间重复确认不重复调用（防重复提交）', async () => {
    let release!: () => void
    auth.logout.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const wrapper = await openLogoutConfirm()

    await footerButton(wrapper, '退出登录').trigger('click')
    await footerButton(wrapper, '退出登录').trigger('click')
    expect(auth.logout).toHaveBeenCalledTimes(1)

    release()
    await flushPromises()
    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })

  it('登出接口失败：不冒泡异常，确认框仍收起（跳转由 useAuth 收口）', async () => {
    auth.logout.mockImplementation(async (): Promise<void> => {
      throw new Error('network down')
    })
    const wrapper = await openLogoutConfirm()

    await footerButton(wrapper, '退出登录').trigger('click')
    await flushPromises()

    expect(wrapper.find('.dialog-stub').exists()).toBe(false)
  })
})
