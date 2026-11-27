import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GrantDetailDialog from './GrantDetailDialog.vue'
import type { GrantItem, UserListItem } from '../../api/types'

const listGrants = vi.fn()
const approveGrant = vi.fn()
const revokeGrant = vi.fn()

vi.mock('../../api/account', () => ({
  listGrants: (...args: unknown[]) => listGrants(...args),
  approveGrant: (...args: unknown[]) => approveGrant(...args),
  revokeGrant: (...args: unknown[]) => revokeGrant(...args),
}))

const USER: UserListItem = {
  user_id: 'u_001',
  agents: [],
  deployed_at: null,
  phone: '13800000000',
  display_name: '张三',
  role: 'user',
  grants_summary: { approved: 1, pending: 1 },
  summary: null,
}

const GRANTS: GrantItem[] = [
  {
    user_id: 'u_001',
    phone: '13800000000',
    display_name: '张三',
    agent_code: 'DH-DEMO01',
    agent_name: '演示数字人',
    status: 'approved',
    source: 'register_link',
    created_at: '2026-11-24 10:00:00',
    reviewed_at: null,
    reviewed_by: null,
  },
  {
    user_id: 'u_001',
    phone: '13800000000',
    display_name: '张三',
    agent_code: 'DH-DEMO02',
    agent_name: '计划助手',
    status: 'pending',
    source: 'apply',
    created_at: '2026-11-24 11:00:00',
    reviewed_at: null,
    reviewed_by: null,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  listGrants.mockResolvedValue({
    items: GRANTS,
    total: GRANTS.length,
    page: 1,
    page_size: 8,
    total_pages: 1,
  })
  approveGrant.mockResolvedValue({})
  revokeGrant.mockResolvedValue({})
})

describe('GrantDetailDialog', () => {
  it('按手机号加载授权记录并展示状态', async () => {
    const wrapper = mount(GrantDetailDialog, { props: { open: true, user: USER } })
    await flushPromises()
    expect(listGrants).toHaveBeenCalledWith({ phone: '13800000000', page: 1 })
    expect(wrapper.text()).toContain('演示数字人')
    expect(wrapper.text()).toContain('计划助手')
    expect(wrapper.text()).toContain('待审批')
  })

  it('审批与关闭调用对应接口并通知刷新', async () => {
    const wrapper = mount(GrantDetailDialog, { props: { open: true, user: USER } })
    await flushPromises()

    await wrapper.findAll('button').find((item) => item.text() === '通过授权')?.trigger('click')
    await flushPromises()
    expect(approveGrant).toHaveBeenCalledWith('u_001', 'DH-DEMO02')

    await wrapper.findAll('button').find((item) => item.text() === '关闭授权')?.trigger('click')
    await flushPromises()
    expect(revokeGrant).toHaveBeenCalledWith('u_001', 'DH-DEMO01')
    expect(wrapper.emitted('changed')).toHaveLength(2)
  })

  it('无手机号的账户不发请求并给出说明', async () => {
    const wrapper = mount(GrantDetailDialog, {
      props: { open: true, user: { ...USER, phone: null } },
    })
    await flushPromises()
    expect(listGrants).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('未绑定手机号')
  })
})
