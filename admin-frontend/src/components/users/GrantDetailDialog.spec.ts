import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentListItem, UserListItem } from '../../api/types'
import GrantDetailDialog from './GrantDetailDialog.vue'

const listAllAgents = vi.fn()
const fetchManifest = vi.fn()
const updateUser = vi.fn()

vi.mock('../../api/agents', () => ({ listAllAgents: (...a: unknown[]) => listAllAgents(...a) }))
vi.mock('../../api/manifest', () => ({ fetchManifest: (...a: unknown[]) => fetchManifest(...a) }))
vi.mock('../../api/users', () => ({ updateUser: (...a: unknown[]) => updateUser(...a) }))

function agent(name: string): AgentListItem {
  return {
    name,
    code: null,
    description: `${name} 的描述`,
    abnormal: false,
    abnormal_reason: null,
    updated_at: '2026-11-27T00:00:00.000Z',
  }
}

const ALL_AGENTS = [agent('demo'), agent('planner'), agent('bom')]

const USER: UserListItem = {
  user_id: 'u_001',
  agents: [{ name: 'demo', abnormal: false, abnormal_reason: null }],
  deployed_at: null,
  phone: '13800000000',
  display_name: '张三',
  role: 'user',
}

function mountDialog(user: UserListItem | null = USER) {
  return mount(GrantDetailDialog, { props: { open: true, user } })
}

function checkboxOf(wrapper: ReturnType<typeof mountDialog>, name: string) {
  return wrapper
    .findAll('.checkbox-list__item')
    .find((li) => li.text().includes(name))!
    .find('input[type="checkbox"]')
}

function submitButton(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.get('[data-test="grant-submit"]')
}

function closeButton(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.get('.base-dialog__close')
}

function confirmDialog(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.find('[data-test="grant-confirm"]')
}

beforeEach(() => {
  vi.clearAllMocks()
  listAllAgents.mockResolvedValue(ALL_AGENTS)
  fetchManifest.mockResolvedValue({ items: [], total: 0, revision: 9 })
  updateUser.mockResolvedValue({})
})

describe('GrantDetailDialog —— 列出全部数字人与当前授权态', () => {
  it('列出平台内全部数字人，并把用户的 agents[] 渲染成已勾选', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(listAllAgents).toHaveBeenCalledTimes(1)
    const text = wrapper.text()
    expect(text).toContain('demo')
    expect(text).toContain('planner')
    expect(text).toContain('bom')
    expect((checkboxOf(wrapper, 'demo').element as HTMLInputElement).checked).toBe(true)
    expect((checkboxOf(wrapper, 'planner').element as HTMLInputElement).checked).toBe(false)
    expect(text).toContain('已授权 1 / 共 3 个数字人')
  })

  it('提示里讲清"勾选只是草稿、点确认才写入、还需部署才生效"', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.text()).toContain('草稿')
    expect(wrapper.text()).toContain('确认')
    expect(wrapper.text()).toContain('放弃本次改动')
    expect(wrapper.text()).toContain('部署')
  })

  it('底部没有「退出」按钮，右上角有 × 关闭', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.findAll('button').filter((item) => item.text() === '退出')).toHaveLength(0)
    expect(closeButton(wrapper).attributes('aria-label')).toBe('关闭')
  })

  it('平台内没有数字人时给出可执行的空态说明', async () => {
    listAllAgents.mockResolvedValue([])
    const wrapper = mountDialog()
    await flushPromises()
    expect(wrapper.text()).toContain('数字人设计')
  })
})

describe('GrantDetailDialog —— 勾选是草稿，确认才生效', () => {
  it('勾选不写库；「确认」由禁用变为可用，改动前直接禁用', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(submitButton(wrapper).text()).toBe('确认')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await checkboxOf(wrapper, 'planner').setValue(true)
    await flushPromises()

    expect(updateUser).not.toHaveBeenCalled()
    expect(fetchManifest).not.toHaveBeenCalled()
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('待确认 2 个')
    // 顶部摘要仍显示已生效的 1 个，草稿不冒充生效值
    expect(wrapper.text()).toContain('已授权 1 / 共 3 个数字人')
  })

  it('点「确认」弹二次确认，确认后才写入 agents[] 并提示需要部署', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await checkboxOf(wrapper, 'planner').setValue(true)
    await flushPromises()

    await submitButton(wrapper).trigger('click')
    await flushPromises()

    const dialog = confirmDialog(wrapper)
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('确认授权变更')
    expect(dialog.text()).toContain('新增授权：planner')
    expect(dialog.get('[data-test="confirm"]').text()).toBe('确认')
    expect(updateUser).not.toHaveBeenCalled()

    await dialog.get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(fetchManifest).toHaveBeenCalledTimes(1)
    expect(updateUser).toHaveBeenCalledWith('u_001', ['demo', 'planner'], 9)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('授权清单已更新')
    expect(wrapper.emitted('announce')?.[0]?.[0]).toContain('部署')
  })

  it('取消勾选已授权的数字人：确认框说明将关闭授权，确认后才移除', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await checkboxOf(wrapper, 'demo').setValue(false)
    await flushPromises()
    expect(updateUser).not.toHaveBeenCalled()

    await submitButton(wrapper).trigger('click')
    await flushPromises()
    expect(confirmDialog(wrapper).text()).toContain('关闭授权：demo')

    await confirmDialog(wrapper).get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(updateUser).toHaveBeenCalledWith('u_001', [], 9)
  })

  it('右上角 × 关闭并丢弃草稿：不发请求、不发 changed', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await checkboxOf(wrapper, 'planner').setValue(true)
    await flushPromises()

    await closeButton(wrapper).trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(updateUser).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('Esc（cancel）同样走关闭：丢弃草稿且不发请求', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await checkboxOf(wrapper, 'planner').setValue(true)
    await flushPromises()

    await wrapper.get('.base-dialog').trigger('cancel')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(updateUser).not.toHaveBeenCalled()
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('写入失败 → 显示错误、草稿保留（勾选不丢），不发 changed', async () => {
    updateUser.mockRejectedValueOnce({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: '' })
    const wrapper = mountDialog()
    await flushPromises()

    await checkboxOf(wrapper, 'planner').setValue(true)
    await flushPromises()
    await submitButton(wrapper).trigger('click')
    await flushPromises()
    await confirmDialog(wrapper).get('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.error-notice').text()).toContain('内容已被他处修改')
    expect((checkboxOf(wrapper, 'planner').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
})
