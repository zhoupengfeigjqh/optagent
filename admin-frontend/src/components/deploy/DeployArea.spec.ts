/**
 * 组件测试：部署功能区——**勾选部署对象的跨分区联动**（2026-09-16 十一次调整）
 *
 * 勾选发生在下分区的用户卡片上，而「校验预检／部署生效」按钮在上分的部署面板里，
 * 状态由共同父级（`DeployArea`）持有。这条链路一旦断开，界面就会出现
 * "勾了却按不动"或"没勾却能部署"（后者会误动全平台），所以必须锁住。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployArea from './DeployArea.vue'
import type { UserListItem } from '../../api/types'

const httpGet = vi.fn()
const validateDeploy = vi.fn()
const deployApi = vi.fn()
const fetchDeployHistoryMock = vi.fn()
const fetchSettings = vi.fn()
const fetchRuntimeForms = vi.fn()

vi.mock('../../api/http', () => ({
  http: { get: (...a: unknown[]) => httpGet(...a), put: vi.fn(), post: vi.fn(), del: vi.fn() },
  ApiError: class extends Error {},
  createHttpClient: vi.fn(),
  CLIENT_ERROR_CODE: {},
  resolveBaseUrl: vi.fn(),
  parseErrorResponse: vi.fn(),
}))

vi.mock('../../api/deploy', () => ({
  // 历史走 api 模块（带 `DEPLOY_HISTORY_FETCH_LIMIT`），不再直接拼 URL
  DEPLOY_HISTORY_FETCH_LIMIT: 100,
  validateDeploy: (...a: unknown[]) => validateDeploy(...a),
  deploy: (...a: unknown[]) => deployApi(...a),
  fetchAnomalies: vi.fn(),
  fetchReferences: vi.fn(),
  fetchDeployHistory: (...a: unknown[]) => fetchDeployHistoryMock(...a),
  fetchManifest: vi.fn(),
}))

vi.mock('../../api/platform', () => ({
  fetchSettings: (...a: unknown[]) => fetchSettings(...a),
  fetchRuntimeForms: (...a: unknown[]) => fetchRuntimeForms(...a),
  saveSettings: vi.fn(),
  fetchHealth: vi.fn(),
}))

vi.mock('../../api/agents', () => ({
  listAgents: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  getAgent: vi.fn(),
  deleteAgent: vi.fn(),
}))

vi.mock('../../api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
}))

const USERS: UserListItem[] = [
  { user_id: 'admin', agents: [], deployed_at: null, summary: null },
  { user_id: 'ops', agents: [], deployed_at: null, summary: null },
]

function mountArea() {
  return mount(DeployArea, { props: { detail: null, tab: 'users' } })
}

function byText(wrapper: ReturnType<typeof mountArea>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text))
}

beforeEach(() => {
  httpGet.mockReset().mockImplementation((url: string) => {
    if (url === '/api/admin/users') {
      return Promise.resolve({ items: USERS, total: 2, page: 1, page_size: 8, total_pages: 1 })
    }
    return Promise.resolve({})
  })
  validateDeploy.mockReset()
  deployApi.mockReset()
  fetchDeployHistoryMock.mockReset().mockResolvedValue({ items: [], truncated: false })
  fetchSettings
    .mockReset()
    .mockResolvedValue({ target_runtime_form: 'container_network', revision: 7 })
  fetchRuntimeForms
    .mockReset()
    .mockResolvedValue({ items: [{ value: 'container_network', label: '容器编排内网' }] })
})

describe('DeployArea —— 勾选部署对象', () => {
  it('未勾选：不能校验、不能部署；勾选后按钮可用', async () => {
    const wrapper = mountArea()
    await flushPromises()

    expect(byText(wrapper, '校验预检')?.attributes('disabled')).toBeDefined()
    expect(byText(wrapper, '部署生效')?.attributes('disabled')).toBeDefined()

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await flushPromises()

    expect(byText(wrapper, '校验预检')?.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).toContain('已选用户：admin')
  })

  it('预检与部署只带**勾选的那些**用户（多勾多带）', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    deployApi.mockResolvedValue({
      target_runtime_form: 'container_network',
      users: [],
      manifest_diff: [],
      history_id: 'h1',
    })
    const wrapper = mountArea()
    await flushPromises()

    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)
    await flushPromises()

    await byText(wrapper, '校验预检')?.trigger('click')
    await flushPromises()
    expect(validateDeploy).toHaveBeenCalledWith(['admin', 'ops'])

    await byText(wrapper, '部署生效')?.trigger('click')
    await flushPromises()
    expect(deployApi).toHaveBeenCalledWith(['admin', 'ops'], 7)
  })

  it('取消勾选后：重新回到"不能校验、不能部署"', async () => {
    const wrapper = mountArea()
    await flushPromises()

    const box = wrapper.findAll('input[type="checkbox"]')[0]!
    await box.setValue(true)
    await flushPromises()
    expect(byText(wrapper, '校验预检')?.attributes('disabled')).toBeUndefined()

    await box.setValue(false)
    await flushPromises()
    expect(byText(wrapper, '校验预检')?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('尚未选择用户')
  })

  it('「清空勾选」一键回到未选状态（并告知）', async () => {
    const wrapper = mountArea()
    await flushPromises()

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await flushPromises()

    await byText(wrapper, '清空勾选')?.trigger('click')
    await flushPromises()

    expect(byText(wrapper, '校验预检')?.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('announce')?.at(-1)).toEqual(['已清空勾选的部署对象'])
  })

  it('部署成功后重新拉取用户列表（卡片要显示"已部署 + 最近一次时间"）', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    deployApi.mockResolvedValue({
      target_runtime_form: 'container_network',
      users: [{ user_id: 'admin', ok: true, agents: [] }],
      manifest_diff: [],
      history_id: 'h1',
    })
    const wrapper = mountArea()
    await flushPromises()
    const callsBefore = httpGet.mock.calls.filter((c) => c[0] === '/api/admin/users').length

    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)
    await flushPromises()
    await byText(wrapper, '校验预检')?.trigger('click')
    await flushPromises()
    await byText(wrapper, '部署生效')?.trigger('click')
    await flushPromises()

    const callsAfter = httpGet.mock.calls.filter((c) => c[0] === '/api/admin/users').length
    expect(callsAfter).toBeGreaterThan(callsBefore)
  })

  it('部署历史按服务端上限一次拉取（有界返回，组件内只翻页不再请求）', async () => {
    mountArea()
    await flushPromises()

    expect(fetchDeployHistoryMock).toHaveBeenCalledWith(100)
  })
})
