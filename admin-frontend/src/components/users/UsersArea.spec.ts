import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserListItem } from '../../api/types'
import UsersArea from './UsersArea.vue'

const api = vi.hoisted(() => ({
  listUsers: vi.fn(),
  deleteUser: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetUserPassword: vi.fn(),
  listAgentServices: vi.fn(),
  listAllAgents: vi.fn(),
  fetchManifest: vi.fn(),
  deployUsers: vi.fn(),
  withdrawUser: vi.fn(),
}))

vi.mock('../../api/users', () => ({
  listUsers: api.listUsers,
  deleteUser: api.deleteUser,
  createUser: api.createUser,
  updateUser: api.updateUser,
  resetUserPassword: api.resetUserPassword,
}))
vi.mock('../../api/account', () => ({
  listAgentServices: api.listAgentServices,
  createAgentService: vi.fn(),
  updateAgentService: vi.fn(),
  deleteAgentService: vi.fn(),
}))
vi.mock('../../api/agents', () => ({ listAllAgents: api.listAllAgents }))
vi.mock('../../api/manifest', () => ({ fetchManifest: api.fetchManifest }))
vi.mock('../../api/deploy', () => ({
  deployUsers: api.deployUsers,
  withdrawUser: api.withdrawUser,
}))

const user: UserListItem = {
  user_id: 'test007',
  agents: [{ name: 'demo', abnormal: false, abnormal_reason: null }],
  deployed_at: null,
  phone: '13900000007',
  display_name: '测试七',
  role: 'user',
}

function pageData(items: UserListItem[]) {
  return { items, total: items.length, page: 1, page_size: 8, total_pages: 1 }
}

/** 页面上有多个 dialog，取标题为「删除账户」的那个 */
function deleteDialog(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('dialog').find((item) => item.text().includes('删除账户'))
}

async function clickDelete(wrapper: ReturnType<typeof mount>): Promise<void> {
  const button = wrapper.findAll('button').find((item) => item.text() === '删除')
  expect(button).toBeTruthy()
  await button!.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listUsers.mockResolvedValue(pageData([user]))
  api.listAgentServices.mockResolvedValue({ items: [] })
  api.listAllAgents.mockResolvedValue([])
  api.fetchManifest.mockResolvedValue({ items: [], total: 0, revision: 9 })
  api.deleteUser.mockResolvedValue(undefined)
  api.withdrawUser.mockResolvedValue({ user_id: 'test007', withdrawn: ['demo'] })
  api.deployUsers.mockResolvedValue({
    users: [
      {
        user_id: 'test007',
        ok: true,
        agents: [
          { name: 'demo', action: 'written', ok: true },
          { name: 'old', action: 'removed', ok: true },
        ],
      },
    ],
    history_id: 'h1',
  })
})

describe('UsersArea —— 删除账户', () => {
  it('确认删除后不出现错误提示，并提示成功、刷新列表', async () => {
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDelete(wrapper)
    await deleteDialog(wrapper)!.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(api.deleteUser).toHaveBeenCalledWith('test007')
    // 回归点：确认框关闭会把 deleteTarget 置 null，若 await 后再读它会抛 TypeError，
    // 界面表现为「请求失败，请稍后重试」且列表不刷新。
    expect(wrapper.find('.error-notice').exists()).toBe(false)
    expect(wrapper.emitted('announce')?.at(-1)).toEqual(['用户 test007 已删除'])
    expect(api.listUsers).toHaveBeenCalledTimes(2)
  })

  it('删除失败时显示业务文案与错误码（而不是无码的兜底文案）', async () => {
    api.deleteUser.mockRejectedValue({ code: 'ADM_USER_NOT_FOUND', message: '' })
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDelete(wrapper)
    await deleteDialog(wrapper)!.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    const notice = wrapper.get('.error-notice')
    expect(notice.text()).toContain('用户不存在')
    expect(notice.text()).toContain('ADM_USER_NOT_FOUND')
  })

  it('删除失败后保留目标账户（不误清 deleteTarget），可重试', async () => {
    api.deleteUser.mockRejectedValueOnce({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: '' })
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDelete(wrapper)
    await deleteDialog(wrapper)!.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('.error-notice').text()).toContain('内容已被他处修改')
    // 再次打开确认框应仍指向同一账户
    await clickDelete(wrapper)
    expect(deleteDialog(wrapper)!.text()).toContain('测试七')
  })
})

describe('UsersArea —— 行内部署', () => {
  async function clickDeploy(wrapper: ReturnType<typeof mount>): Promise<void> {
    const button = wrapper.findAll('button').find((item) => item.text() === '部署')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flushPromises()
    const dialog = wrapper.findAll('dialog').find((item) => item.text().includes('部署该账户'))
    expect(dialog).toBeTruthy()
    await dialog!.get('[data-test="confirm"]').trigger('click')
    await flushPromises()
  }

  it('点击部署只打开二次确认，未确认前不调用部署接口', async () => {
    const wrapper = mount(UsersArea)
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text() === '部署')
    await button!.trigger('click')
    await flushPromises()

    const dialog = wrapper.findAll('dialog').find((item) => item.text().includes('部署该账户'))
    expect(dialog?.text()).toContain('测试七')
    expect(dialog?.text()).toContain('整体覆盖')
    expect(api.deployUsers).not.toHaveBeenCalled()
    expect(api.fetchManifest).not.toHaveBeenCalled()
  })

  it('部署只针对该账户：版本号现取现用，成功后播报写入/移除数量并刷新列表', async () => {
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDeploy(wrapper)

    expect(api.fetchManifest).toHaveBeenCalledTimes(1)
    expect(api.deployUsers).toHaveBeenCalledWith(['test007'], 9)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('部署完成：写入 1 个、移除 1 个')
    expect(api.listUsers).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.error-notice').exists()).toBe(false)
  })

  it('部署返回失败时播报失败原因，不吞掉错误', async () => {
    api.deployUsers.mockResolvedValueOnce({
      users: [{ user_id: 'test007', ok: false, agents: [], error: '目标目录不可写' }],
      history_id: 'h2',
    })
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDeploy(wrapper)

    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toBe('用户 test007 部署失败：目标目录不可写')
  })

  it('版本冲突时显示可读错误（提示刷新后重试）', async () => {
    api.deployUsers.mockRejectedValueOnce({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: '' })
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickDeploy(wrapper)

    expect(wrapper.get('.error-notice').text()).toContain('内容已被他处修改')
  })
})

describe('UsersArea —— 停止（撤回部署，§6.9）', () => {
  const deployed: UserListItem = { ...user, deployed_at: '2026-11-27 10:00:00' }

  async function clickStop(wrapper: ReturnType<typeof mount>): Promise<void> {
    const button = wrapper.findAll('button').find((item) => item.text() === '停止')
    expect(button).toBeTruthy()
    await button!.trigger('click')
    await flushPromises()
  }

  it('点击停止先二次确认；确认后按用户撤回全部副本并刷新列表', async () => {
    api.listUsers.mockResolvedValue(pageData([deployed]))
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickStop(wrapper)
    const dialog = wrapper.findAll('dialog').find((item) => item.text().includes('停止该账户'))
    expect(dialog?.text()).toContain('测试七')
    expect(dialog?.text()).toContain('立即无法使用')
    expect(api.withdrawUser).not.toHaveBeenCalled()

    await dialog!.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(api.fetchManifest).toHaveBeenCalledTimes(1)
    expect(api.withdrawUser).toHaveBeenCalledWith('test007', 9)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('已停止：撤回 1 个数字人副本')
    expect(api.listUsers).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.error-notice').exists()).toBe(false)
  })

  it('未部署的账户「停止」不可点（没有可撤回的副本）', async () => {
    const wrapper = mount(UsersArea)
    await flushPromises()

    const button = wrapper.findAll('button').find((item) => item.text() === '停止')
    expect(button?.attributes('disabled')).toBeDefined()
  })

  it('撤回失败显示可读原因（版本冲突）', async () => {
    api.listUsers.mockResolvedValue(pageData([deployed]))
    api.withdrawUser.mockRejectedValueOnce({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: '' })
    const wrapper = mount(UsersArea)
    await flushPromises()

    await clickStop(wrapper)
    await wrapper
      .findAll('dialog')
      .find((item) => item.text().includes('停止该账户'))!
      .get('[data-test="confirm"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.get('.error-notice').text()).toContain('内容已被他处修改')
  })
})
