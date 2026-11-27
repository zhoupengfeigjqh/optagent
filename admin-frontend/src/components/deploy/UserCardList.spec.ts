import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserCardList from './UserCardList.vue'
import type { UserListItem } from '../../api/types'

const listAgents = vi
  .fn()
  .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
const deleteUser = vi.fn()
const updateUser = vi.fn()
const resetUserPassword = vi.fn()
const withdrawDeploy = vi.fn()
const fetchManifest = vi.fn()

vi.mock('../../api/deploy', () => ({
  withdrawDeploy: (...a: unknown[]) => withdrawDeploy(...a),
  deploy: vi.fn(),
  fetchReferences: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: (...a: unknown[]) => fetchManifest(...a),
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
  updateUser: (...args: unknown[]) => updateUser(...args),
  deleteUser: (...args: unknown[]) => deleteUser(...args),
  resetUserPassword: (...args: unknown[]) => resetUserPassword(...args),
}))

vi.mock('../../api/http', () => ({
  http: { get: vi.fn().mockResolvedValue({}), put: vi.fn(), post: vi.fn(), del: vi.fn() },
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
  updateUser.mockReset()
  resetUserPassword.mockReset()
  withdrawDeploy.mockReset()
  fetchManifest.mockReset().mockResolvedValue({ items: [], total: 0, revision: 1 })
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

  it('删除需二次确认，且说明"撤回数字人、保留文件空间"（2026-10-20）', async () => {
    const wrapper = mountList()
    const del = wrapper.findAll('button').find((b) => b.text() === '删除')
    await del?.trigger('click')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-test="delete-dialog"]')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('撤回该用户在运行环境中的数字人')
    expect(dialog.text()).toContain('文件空间的内容一律保留')
  })

  it('确认删除调用接口、发出 changed 与 removed（后者用于清掉部署勾选）', async () => {
    deleteUser.mockResolvedValue(undefined)
    const wrapper = mountList()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(deleteUser).toHaveBeenCalledWith('admin')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('removed')).toEqual([['admin']])
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
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '清空勾选')
      ?.trigger('click')
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

    expect(fetchManifest).toHaveBeenCalled()
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

describe('UserCardList —— 编辑关联保存（2026-10-14）', () => {
  const AGENTS = [
    {
      name: 'demo',
      description: '演示',
      abnormal: false,
      abnormal_reason: null,
      updated_at: '2026-10-01T00:00:00.000Z',
    },
    {
      name: 'extra',
      description: '新数字人',
      abnormal: false,
      abnormal_reason: null,
      updated_at: '2026-10-01T00:00:00.000Z',
    },
  ]

  async function openEditor(wrapper: ReturnType<typeof mountList>): Promise<void> {
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '编辑关联')
      ?.trigger('click')
    await flushPromises()
  }

  function saveButton(wrapper: ReturnType<typeof mountList>) {
    return wrapper.findAll('button').find((b) => b.text() === '保存')
  }

  it('选完数字人保存：版本取自部署清单端点，成功发出 changed + announce', async () => {
    listAgents.mockResolvedValueOnce({
      items: AGENTS,
      total: 2,
      page: 1,
      page_size: 8,
      total_pages: 1,
    })
    updateUser.mockResolvedValue({
      user_id: 'admin',
      agents: ['demo', 'broken', 'extra'],
      revision: 2,
    })

    const wrapper = mountList()
    await openEditor(wrapper)

    const option = wrapper
      .findAll('li.checkbox-list__item')
      .find((li) => li.text().includes('extra'))
    await option!.find('input[type="checkbox"]').setValue(true)
    await saveButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(fetchManifest).toHaveBeenCalled()
    expect(updateUser).toHaveBeenCalledWith('admin', ['demo', 'broken', 'extra'], 1)
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('关联已更新')
  })

  it('保存失败：以"操作未完成"呈现可读原因，不冒充列表加载失败', async () => {
    updateUser.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })

    const wrapper = mountList()
    await openEditor(wrapper)
    await saveButton(wrapper)!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('操作未完成')
    expect(wrapper.text()).toContain('内容已被他处修改，请刷新后重试')
    expect(wrapper.text()).not.toContain('用户与关联数字人加载失败')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
})

/**
 * 重置密码（2026-11-18，契约 §6.4.1）。
 *
 * 卡片按钮统一叫「重置密码」，不区分"已设过/从未设过"——两种意图由弹窗文案覆盖，
 * 避免为措辞给列表接口加字段（Q5 结论）。
 */
describe('UserCardList —— 重置密码（2026-11-18）', () => {
  async function openReset(wrapper: ReturnType<typeof mountList>, index = 0): Promise<void> {
    await wrapper
      .findAll('article.card')
      [index]!.findAll('button')
      .find((b) => b.text() === '重置密码')
      ?.trigger('click')
    await flushPromises()
  }

  function dialog(wrapper: ReturnType<typeof mountList>) {
    return wrapper.find('[data-test="reset-password-dialog"]')
  }

  it('每张卡片都有「重置密码」入口，点击打开对应用户的弹窗', async () => {
    const wrapper = mountList()
    const buttons = wrapper.findAll('button').filter((b) => b.text() === '重置密码')
    expect(buttons).toHaveLength(2) // admin / ops

    await openReset(wrapper, 1)
    expect(dialog(wrapper).attributes('open')).toBeDefined()
    expect(dialog(wrapper).text()).toContain('重置密码：ops')
    expect(resetUserPassword).not.toHaveBeenCalled()
  })

  it('提交新密码：调接口（不带 revision），播报会话失效并关闭弹窗', async () => {
    resetUserPassword.mockResolvedValue({ user_id: 'admin', agents: [], revision: 7 })
    const wrapper = mountList()
    await openReset(wrapper)

    await dialog(wrapper).find('#reset-password').setValue('new-secret')
    await dialog(wrapper).find('#reset-password-confirm').setValue('new-secret')
    await dialog(wrapper)
      .findAll('button')
      .find((b) => b.text() === '确认重置')
      ?.trigger('click')
    await flushPromises()

    expect(resetUserPassword).toHaveBeenCalledWith('admin', 'new-secret')
    expect(wrapper.emitted('announce')?.at(-1)?.[0]).toContain('原有登录会话已失效')
    expect(dialog(wrapper).attributes('open')).toBeUndefined()
  })

  it('失败：弹窗保持打开、错误就地展示，且不冒充列表加载失败', async () => {
    resetUserPassword.mockRejectedValue({ code: 'ADM_USER_NOT_FOUND', message: 'x' })
    const wrapper = mountList()
    await openReset(wrapper)

    await dialog(wrapper).find('#reset-password').setValue('new-secret')
    await dialog(wrapper).find('#reset-password-confirm').setValue('new-secret')
    await dialog(wrapper)
      .findAll('button')
      .find((b) => b.text() === '确认重置')
      ?.trigger('click')
    await flushPromises()

    expect(dialog(wrapper).attributes('open')).toBeDefined()
    expect(dialog(wrapper).text()).toContain('密码未重置')
    expect(wrapper.text()).not.toContain('用户与关联数字人加载失败')
    expect(wrapper.emitted('changed')).toBeUndefined()
  })
})
