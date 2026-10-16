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

const listAgents = vi
  .fn()
  .mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
const deleteUser = vi.fn()
const updateUser = vi.fn()
const withdrawDeploy = vi.fn()
const fetchManifest = vi.fn()

vi.mock('../../api/deploy', () => ({
  withdrawDeploy: (...a: unknown[]) => withdrawDeploy(...a),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchReferences: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchDeployHistory: vi.fn(),
  // 乐观锁版本的**唯一**来源（2026-09-27「目标运行形态」下架后
  // `/api/admin/platform/settings` 已不存在，取版本会 404 → 保存必失败）
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
}))

vi.mock('../../api/http', () => ({
  // 故意**不**提供 revision：组件取版本 MUST 走部署清单端点。一旦有人改回
  // `/api/admin/platform/settings`（那个路由已下架），版本断言就会失败。
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
  withdrawDeploy.mockReset()
  // 乐观锁版本：由部署清单端点给出（当前 revision = 1）
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
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '删除')
      ?.trigger('click')
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

    // 版本取自部署清单端点（fetchManifest → revision: 1）
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

/**
 * 编辑关联保存（2026-10-14 修复回归）。
 *
 * 原先这里取版本用的是**已下架**的 `/api/admin/platform/settings` ⇒ 一保存就 404
 * （NOT_FOUND「请求的内容不存在」），保存根本走不到 `updateUser`。
 * 且该错误被同时喂进卡片列表的错误位，顶着"用户与关联数字人加载失败"展示——
 * 一个"保存失败"被误报成"加载失败"。下面两条分别守住这两点。
 */
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

  /** 打开"编辑关联"（候选数字人由 `listAgents` 提供） */
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

    // "选了数字人"：admin 原本关联 demo / broken，这里再勾上 extra
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
