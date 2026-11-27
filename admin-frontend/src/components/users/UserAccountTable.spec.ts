import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import UserAccountTable from './UserAccountTable.vue'
import type { AgentServiceItem, UserListItem } from '../../api/types'

const USER: UserListItem = {
  user_id: 'u_001',
  agents: [],
  deployed_at: null,
  phone: '13800000000',
  display_name: '张三',
  role: 'user',
  source_agent_code: 'DH-DEMO01',
  grants_summary: { approved: 2, pending: 1 },
  summary: null,
}

const SERVICE: AgentServiceItem = {
  code: 'DH-DEMO01',
  name: '演示数字人',
  platform_agent_name: 'demo',
  status: 'enabled',
  registered_users: 8,
  created_at: '2026-11-24 10:00:00',
  updated_at: '2026-11-24 10:00:00',
}

function mountTable(items: UserListItem[] = [USER]) {
  return mount(UserAccountTable, {
    props: {
      items,
      services: [SERVICE],
      total: items.length,
      page: 1,
      pageSize: 8,
      loading: false,
      error: null,
    },
  })
}

describe('UserAccountTable', () => {
  it('展示账户、注册来源与授权概况', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('13800000000')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('演示数字人（DH-DEMO01）')
    expect(wrapper.text()).toContain('已授权 2')
    expect(wrapper.text()).toContain('申请中 1')
  })

  it('行操作发出对应账户', async () => {
    const wrapper = mountTable()
    const grants = wrapper.findAll('button').find((item) => item.text() === '授权详情')
    await grants?.trigger('click')
    expect(wrapper.emitted('grants')?.[0]).toEqual([USER])

    const edit = wrapper.findAll('button').find((item) => item.text() === '修改')
    await edit?.trigger('click')
    expect(wrapper.emitted('edit')?.[0]).toEqual([USER])

    const reset = wrapper.findAll('button').find((item) => item.text() === '重置密码')
    await reset?.trigger('click')
    expect(wrapper.emitted('reset-password')?.[0]).toEqual([USER])

    const remove = wrapper.findAll('button').find((item) => item.text() === '删除')
    await remove?.trigger('click')
    expect(wrapper.emitted('delete')?.[0]).toEqual([USER])
  })

  it('空列表使用可区分的空态', () => {
    const wrapper = mountTable([])
    expect(wrapper.text()).toContain('没有符合条件的账户')
  })
})
