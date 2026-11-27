import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import UserAccountTable from './UserAccountTable.vue'
import type { AgentServiceItem, UserListItem } from '../../api/types'

const USER: UserListItem = {
  user_id: 'u_001',
  agents: [
    { name: 'demo', abnormal: false, abnormal_reason: null },
    { name: 'planner', abnormal: false, abnormal_reason: null },
  ],
  deployed_at: null,
  phone: '13800000000',
  display_name: '张三',
  role: 'user',
  source_agent_code: 'DH-DEMO01',
}

const NO_AGENT_USER: UserListItem = { ...USER, user_id: 'u_002', agents: [] }

const SERVICE: AgentServiceItem = {
  code: 'DH-DEMO01',
  name: '演示数字人',
  platform_agent_name: 'demo',
  status: 'enabled',
  registered_users: 8,
  created_at: '2026-11-24 10:00:00',
  updated_at: '2026-11-24 10:00:00',
}

function mountTable(
  items: UserListItem[] = [USER],
  deployingUserId: string | null = null,
  withdrawingUserId: string | null = null,
) {
  return mount(UserAccountTable, {
    props: {
      items,
      services: [SERVICE],
      total: items.length,
      page: 1,
      pageSize: 8,
      loading: false,
      error: null,
      deployingUserId,
      withdrawingUserId,
    },
  })
}

const DEPLOYED: UserListItem = { ...USER, deployed_at: '2026-11-27 10:00:00' }

function buttonByText(wrapper: ReturnType<typeof mountTable>, text: string) {
  return wrapper.findAll('button').find((item) => item.text() === text)
}

describe('UserAccountTable', () => {
  it('展示账户、注册来源、已授权数与部署状态', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('13800000000')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('演示数字人（DH-DEMO01）')
    expect(wrapper.text()).toContain('已授权 2')
    expect(wrapper.text()).toContain('未部署')
  })

  it('未授权任何数字人时显示「未授权」', () => {
    const wrapper = mountTable([NO_AGENT_USER])
    expect(wrapper.text()).toContain('未授权')
  })

  it('已部署的账户显示「已部署」', () => {
    const wrapper = mountTable([{ ...USER, deployed_at: '2026-11-27 10:00:00' }])
    expect(wrapper.text()).toContain('已部署')
  })

  it('行操作发出对应账户（授权详情 / 部署 / 重置密码 / 删除）', async () => {
    const wrapper = mountTable()

    await buttonByText(wrapper, '授权详情')!.trigger('click')
    expect(wrapper.emitted('grants')?.[0]).toEqual([USER])

    await buttonByText(wrapper, '部署')!.trigger('click')
    expect(wrapper.emitted('deploy')?.[0]).toEqual([USER])

    await buttonByText(wrapper, '重置密码')!.trigger('click')
    expect(wrapper.emitted('reset-password')?.[0]).toEqual([USER])

    await buttonByText(wrapper, '删除')!.trigger('click')
    expect(wrapper.emitted('delete')?.[0]).toEqual([USER])
  })

  it('不再提供「修改」入口（编辑已收敛到授权详情与新建）', () => {
    const wrapper = mountTable()
    expect(buttonByText(wrapper, '修改')).toBeUndefined()
  })

  it('未授权任何数字人时「部署」按钮禁用（没有可下发的内容）', () => {
    const wrapper = mountTable([NO_AGENT_USER])
    const deploy = buttonByText(wrapper, '部署')!
    expect((deploy.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('部署进行中：该行按钮文案为「部署中…」且禁用', () => {
    const wrapper = mountTable([USER], USER.user_id)
    const deploying = buttonByText(wrapper, '部署中…')!
    expect((deploying.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('「停止」位于部署与删除之间，已部署账户可点并发出撤回意图（2026-11-27）', async () => {
    const wrapper = mountTable([DEPLOYED])
    const labels = wrapper.findAll('button').map((item) => item.text())
    const deployIndex = labels.indexOf('部署')
    const stopIndex = labels.indexOf('停止')
    const deleteIndex = labels.indexOf('删除')
    expect(deployIndex).toBeGreaterThanOrEqual(0)
    expect(stopIndex).toBe(deployIndex + 1)
    expect(stopIndex).toBeLessThan(deleteIndex)

    await buttonByText(wrapper, '停止')!.trigger('click')
    expect(wrapper.emitted('withdraw')?.[0]).toEqual([DEPLOYED])
  })

  it('未部署的账户「停止」禁用：没有可撤回的运行副本', () => {
    const wrapper = mountTable()
    const stop = buttonByText(wrapper, '停止')!
    expect((stop.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('撤回进行中：该行文案为「停止中…」且禁用', () => {
    const wrapper = mountTable([DEPLOYED], null, DEPLOYED.user_id)
    const stopping = buttonByText(wrapper, '停止中…')!
    expect((stopping.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('空列表使用可区分的空态', () => {
    const wrapper = mountTable([])
    expect(wrapper.text()).toContain('没有符合条件的账户')
  })
})
