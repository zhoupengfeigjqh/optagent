/**
 * 组件测试：用户卡片列表（T082）
 *
 * 守住 `FR-023`：卡片展示用户名与已关联数字人角色名清单，可展开查看
 * 搭配摘要与异常标记（部署前核对总账）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserCardList from './UserCardList.vue'
import type { UserListItem } from '../../api/types'

const listAgents = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
const deleteUser = vi.fn()
const withdrawDeploy = vi.fn()

vi.mock('../../api/deploy', () => ({
  withdrawDeploy: (...a: unknown[]) => withdrawDeploy(...a),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchReferences: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
}))

vi.mock('../../api/agents', () => ({
  listAgents: (...args: unknown[]) => listAgents(...args),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  getAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

vi.mock('../../api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: (...args: unknown[]) => deleteUser(...args),
}))

vi.mock('../../api/http', () => ({
  http: { get: vi.fn().mockResolvedValue({ revision: 1 }), put: vi.fn(), post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  createHttpClient: vi.fn(),
  CLIENT_ERROR_CODE: {},
  resolveBaseUrl: vi.fn(),
  parseErrorResponse: vi.fn(),
}))

const USERS: UserListItem[] = [
  {
    user_id: 'admin',
    agents: [
      { name: 'demo', abnormal: false, abnormal_reason: null },
      { name: 'broken', abnormal: true, abnormal_reason: '内置工具「ghost」已失效' },
    ],
    deployed_at: '2026-09-16T02:30:00.000Z',
    summary: [
      { name: 'demo', mcp_services: ['ocr'], enabled_tools: ['read_file'], skills: ['pdf-parse'] },
      { name: 'broken', mcp_services: [], enabled_tools: ['ghost'], skills: [] },
    ],
  },
  { user_id: 'ops', agents: [], deployed_at: null, summary: null },
]

function mountList(overrides: Record<string, unknown> = {}) {
  return mount(UserCardList, {
    props: {
      items: USERS,
      total: 2,
      page: 1,
      loading: false,
      error: null,
      selected: [],
      ...overrides,
    },
  })
}

beforeEach(() => {
  deleteUser.mockReset()
  withdrawDeploy.mockReset()
})

describe('UserCardList', () => {
  it('卡片展示用户名与已关联数字人数量', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('admin')
    expect(wrapper.text()).toContain('已关联 2 个数字人')
  })

  it('展开后可看到搭配摘要（MCP / 工具 / SKILL）与异常标记（FR-023）', async () => {
    const wrapper = mountList()
    await wrapper.find('details summary').trigger('click')
    const text = wrapper.text()
    expect(text).toContain('MCP ocr')
    expect(text).toContain('工具 read_file')
    expect(text).toContain('SKILL pdf-parse')
    expect(text).toContain('ghost')
  })

  it('异常数字人给出可读原因且不只靠颜色', () => {
    const wrapper = mountList()
    const badges = wrapper.findAll('[data-status="abnormal"]')
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.some((b) => b.text().includes('失效'))).toBe(true)
  })

  it('未关联任何数字人时给出明确文案（而非空白）', () => {
    const wrapper = mountList({ items: [USERS[1]], total: 1 })
    expect(wrapper.text()).toContain('未关联任何数字人')
  })

  it('删除需二次确认，且说明不删除运行环境数据目录（FR-028）', async () => {
    const wrapper = mountList()
    const del = wrapper.findAll('button').find((b) => b.text() === '删除')
    await del?.trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('dialog')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('不会删除运行环境中该用户的数据目录')
  })

  it('确认删除调用接口并发出 changed', async () => {
    deleteUser.mockResolvedValue(undefined)
    const wrapper = mountList()
    await wrapper.findAll('button').find((b) => b.text() === '删除')?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(deleteUser).toHaveBeenCalledWith('admin')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('边界：空列表显示空态引导', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('还没有用户')
  })

  it('边界：失败时显示可读原因', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'ADM_RUNTIME_UNREACHABLE', message: 'x' },
    })
    expect(wrapper.text()).toContain('运行环境不可达')
  })
})

describe('UserCardList —— 部署对象勾选与部署状态（2026-09-16）', () => {
  it('部署状态：已部署显示最近一次时间，未部署显示"未部署"', () => {
    const wrapper = mountList()

    expect(wrapper.find('[data-status="deployed"]').text()).toContain('已部署')
    expect(wrapper.find('[data-status="not_deployed"]').text()).toContain('未部署')
    // 未部署的用户 `deployed_at` 为 null，界面上不能出现 "null"
    expect(wrapper.text()).not.toContain('null')
  })

  it('勾选框：勾上即发出 toggle（部署对象由卡片选定）', async () => {
    const wrapper = mountList()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes).toHaveLength(2)

    await boxes[0]!.setValue(true)
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['admin', true])

    await boxes[1]!.setValue(true)
    expect(wrapper.emitted('toggle')?.[1]).toEqual(['ops', true])
  })

  it('取消勾选同样上报（false）', async () => {
    const wrapper = mountList({ selected: ['admin'] })
    const box = wrapper.findAll('input[type="checkbox"]')[0]!
    expect((box.element as HTMLInputElement).checked).toBe(true)

    await box.setValue(false)
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['admin', false])
  })

  it('已勾选回显 + 顶部显示数量且可一键清空', async () => {
    const wrapper = mountList({ selected: ['admin', 'ops'] })

    expect(wrapper.text()).toContain('已勾选 2 个部署对象')
    await wrapper.findAll('button').find((b) => b.text() === '清空勾选')?.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('未勾选时不显示"已勾选/清空"（避免与空态混淆）', () => {
    const wrapper = mountList()
    expect(wrapper.text()).not.toContain('已勾选')
    expect(wrapper.findAll('button').some((b) => b.text() === '清空勾选')).toBe(false)
  })

  it('读屏可用：勾选框的无障碍名称带用户标识（不混淆）', () => {
    const wrapper = mountList()
    const boxes = wrapper.findAll('input[type="checkbox"]')
    expect(boxes[0]!.attributes('aria-label')).toContain('admin')
    expect(boxes[1]!.attributes('aria-label')).toContain('ops')
  })
})

describe('UserCardList —— 撤回部署（2026-09-16）', () => {
  function withdrawButton(wrapper: ReturnType<typeof mountList>, index: number) {
    return wrapper
      .findAll('article.card')
      [index]!.findAll('button')
      .find((b) => b.text() === '撤回')
  }

  it('只有"已部署"的用户才有撤回入口', () => {
    const wrapper = mountList()
    expect(withdrawButton(wrapper, 0)).toBeTruthy() // admin 已部署
    expect(withdrawButton(wrapper, 1)).toBeUndefined() // ops 未部署
  })

  it('撤回需二次确认，并讲明"数字人将失去能力 + 文件空间保留"', async () => {
    const wrapper = mountList()
    await withdrawButton(wrapper, 0)!.trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-test="withdraw-dialog"]')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('失去能力')
    expect(dialog.text()).toContain('文件空间')
    expect(withdrawDeploy).not.toHaveBeenCalled()
  })

  it('确认后按当前 revision 调撤回接口，并发出 changed 让列表刷新', async () => {
    withdrawDeploy.mockResolvedValue({ user_id: 'admin', withdrawn: ['demo'] })
    const wrapper = mountList()

    await withdrawButton(wrapper, 0)!.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="withdraw-dialog"] [data-test="confirm"]').trigger('click')
    await flushPromises()

    // http.get 被 mock 为 { revision: 1 }
    expect(withdrawDeploy).toHaveBeenCalledWith('admin', 1)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('下架 1 个数字人')
  })

  it('撤回失败：给出可读原因且不发 changed（不改状态）', async () => {
    withdrawDeploy.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const wrapper = mountList()

    await withdrawButton(wrapper, 0)!.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="withdraw-dialog"] [data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('changed')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').text().length).toBeGreaterThan(0)
  })
})
