/**
 * 组件测试：部署面板（T082）
 *
 * 守住三件事：
 * 1. **未勾选部署对象时不能部署**（空选择绝不能落回"全部用户"，那会变成误部署全平台）；
 * 2. **勾选后无需任何预检即可直接部署**（2026-11-23：预检下架）；
 * 3. 逐用户失败原因（`users[].ok=false` + `error`）与整批 404 名单都能就地看到。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployPanel from './DeployPanel.vue'

const fetchManifest = vi.fn().mockResolvedValue({ items: [], total: 0, revision: 7 })
const deployApi = vi.fn()

vi.mock('../../api/deploy', () => ({
  deploy: (...a: unknown[]) => deployApi(...a),
  fetchReferences: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: (...a: unknown[]) => fetchManifest(...a),
}))

function mountPanel(selectedUserIds: string[] = ['admin']) {
  return mount(DeployPanel, { props: { selectedUserIds } })
}

function buttons(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('button')
}

function deployButton(wrapper: ReturnType<typeof mountPanel>) {
  return buttons(wrapper).find((b) => b.text().includes('部署生效'))
}

beforeEach(() => {
  deployApi.mockReset()
  fetchManifest.mockClear()
})

describe('DeployPanel', () => {
  it('展示本次范围（来自勾选的部署对象）', async () => {
    const wrapper = mountPanel(['admin', 'ops'])
    await flushPromises()
    expect(wrapper.text()).toContain('本次范围：')
    expect(wrapper.text()).toContain('已选用户：admin、ops')
  })

  it('未勾选任何用户：部署不可用，并提示先勾选（MUST NOT 落到"全部用户"）', async () => {
    const wrapper = mountPanel([])
    await flushPromises()

    expect(deployButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('尚未选择用户')
    expect(wrapper.text()).toContain('请先勾选部署对象')
  })

  it('2026-11-23：勾选后无需预检，部署按钮直接可用', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(deployButton(wrapper)?.attributes('disabled')).toBeUndefined()
    expect(wrapper.text()).not.toContain('校验预检')
  })

  it('2026-11-23：进入面板不预读版本（提交前那次读取已足够，界面上也不显示 revision）', async () => {
    mountPanel()
    await flushPromises()

    expect(fetchManifest).not.toHaveBeenCalled()
  })

  it('差异项按「用户 / 数字人：说明」呈现（与部署历史同一格式）', async () => {
    deployApi.mockResolvedValue({
      users: [{ user_id: 'admin', ok: true, agents: [] }],
      manifest_diff: [
        {
          user_id: 'admin',
          target: 'demo',
          kind: 'missing_in_runtime',
          detail: '运行环境缺失',
        },
      ],
      history_id: 'h1',
    })
    const wrapper = mountPanel()
    await flushPromises()

    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('admin / demo：运行环境缺失')
  })

  it('部署带上勾选的用户，且成功后发出 deployed', async () => {
    deployApi.mockResolvedValue({
      users: [
        { user_id: 'admin', ok: true, agents: [{ name: 'demo', action: 'written', ok: true }] },
        { user_id: 'ops', ok: false, agents: [], error: '目标不可写' },
      ],
      manifest_diff: [],
      history_id: 'h1',
    })
    const wrapper = mountPanel(['admin', 'ops'])
    await flushPromises()

    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(deployApi).toHaveBeenCalledWith(['admin', 'ops'], 7)
    expect(wrapper.text()).toContain('部署结果')
    expect(wrapper.text()).toContain('h1')
    expect(wrapper.text()).toContain('目标不可写')
    expect(wrapper.emitted('deployed')).toHaveLength(1)
  })

  it('2026-10-20：整批 404 时列出"已不存在的用户"名单（只有错误码无法定位）', async () => {
    deployApi.mockRejectedValue({
      code: 'ADM_USER_NOT_FOUND',
      message: '用户不存在：ghost',
      details: { user_ids: ['ghost'] },
    })
    const wrapper = mountPanel(['admin', 'ghost'])
    await flushPromises()

    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('用户不存在')
    expect(wrapper.text()).toContain('勾选列表中已不存在的用户')
    expect(wrapper.text()).toContain('ghost')
  })

  it('请求级失败（如写入目标不可用）：错误提示可读', async () => {
    deployApi.mockRejectedValue({
      code: 'ADM_STORAGE_UNAVAILABLE',
      message: 'x',
    })
    const wrapper = mountPanel()
    await flushPromises()

    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('部署未完成')
  })
})
