/**
 * 组件测试：部署面板（T082）
 *
 * 守住三件事：
 * 1. `SC-020`：校验不通过时**一次性列出全部错误项**，且部署按钮不可用；
 * 2. **未勾选部署对象时既不能校验、也不能部署**（空选择绝不能落回"全部用户"，
 *    那会变成误部署全平台）；
 * 3. **勾选一变，上一次预检作废**（部署按钮重新禁用），避免"用 A 的结论部署 B"。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DeployPanel from './DeployPanel.vue'

const fetchManifest = vi.fn().mockResolvedValue({ items: [], total: 0, revision: 7 })
const validateDeploy = vi.fn()
const deployApi = vi.fn()

vi.mock('../../api/deploy', () => ({
  validateDeploy: (...a: unknown[]) => validateDeploy(...a),
  deploy: (...a: unknown[]) => deployApi(...a),
  fetchReferences: vi.fn(),
  fetchAnomalies: vi.fn(),
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

function validateButton(wrapper: ReturnType<typeof mountPanel>) {
  return buttons(wrapper).find((b) => b.text().includes('校验预检'))
}

beforeEach(() => {
  validateDeploy.mockReset()
  deployApi.mockReset()
})

describe('DeployPanel', () => {
  it('展示本次范围（来自勾选的部署对象）', async () => {
    const wrapper = mountPanel(['admin', 'ops'])
    await flushPromises()
    expect(wrapper.text()).toContain('本次范围：')
    expect(wrapper.text()).toContain('已选用户：admin、ops')
  })

  it('未勾选任何用户：校验与部署都不可用，并提示先勾选（MUST NOT 落到"全部用户"）', async () => {
    const wrapper = mountPanel([])
    await flushPromises()

    expect(validateButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(deployButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('尚未选择用户')
    expect(wrapper.text()).toContain('请先勾选部署对象')
  })

  it('未校验前部署按钮不可用（MUST 先预检）', async () => {
    const wrapper = mountPanel()
    await flushPromises()
    expect(deployButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('请先执行校验预检')
  })

  it('校验通过后部署按钮可用，并播报「校验通过 + 范围」', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    const wrapper = mountPanel()
    await flushPromises()

    await validateButton(wrapper)?.trigger('click')
    await flushPromises()

    // 预检 MUST 带上勾选的用户（否则会被服务端理解为"全部用户"）
    expect(validateDeploy).toHaveBeenCalledWith(['admin'])
    expect(wrapper.emitted('announce')?.[0]).toEqual(['部署前校验通过（范围：已选用户：admin）'])
    expect(deployButton(wrapper)?.attributes('disabled')).toBeUndefined()
  })

  it('校验不通过：一次性列出全部错误项，并说明运行环境零写入（SC-020）', async () => {
    validateDeploy.mockResolvedValue({
      passed: false,
      errors: [
        { user_id: 'admin', agent_name: 'demo', category: 'config_integrity', code: 'VALIDATION_FAILED', message: 'SOUL 为空' },
        { user_id: 'ops', agent_name: 'demo2', category: 'reference_validity', code: 'ADM_AGENT_INVALID_REF', message: '引用了清单外的工具 ghost' },
      ],
    })
    const wrapper = mountPanel(['admin', 'ops'])
    await flushPromises()

    await validateButton(wrapper)?.trigger('click')
    await flushPromises()

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('运行环境零写入')
    expect(wrapper.text()).toContain('SOUL 为空')
    expect(wrapper.text()).toContain('引用了清单外的工具 ghost')
    // 校验未通过 → 部署按钮保持不可用（阻止部署）
    expect(deployButton(wrapper)?.attributes('disabled')).toBeDefined()
  })

  it('勾选变化 → 上一次预检作废：部署按钮重新禁用', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    const wrapper = mountPanel(['admin'])
    await flushPromises()

    await validateButton(wrapper)?.trigger('click')
    await flushPromises()
    expect(deployButton(wrapper)?.attributes('disabled')).toBeUndefined()

    // 又多勾了一个用户 → 范围变了 → 结论不再适用
    await wrapper.setProps({ selectedUserIds: ['admin', 'ops'] })
    expect(deployButton(wrapper)?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('请先执行校验预检')
  })

  it('部署带上勾选的用户，且成功后发出 deployed', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
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

    await validateButton(wrapper)?.trigger('click')
    await flushPromises()
    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(deployApi).toHaveBeenCalledWith(['admin', 'ops'], 7)
    expect(wrapper.text()).toContain('部署结果')
    expect(wrapper.text()).toContain('h1')
    expect(wrapper.text()).toContain('目标不可写')
    expect(wrapper.emitted('deployed')).toHaveLength(1)
  })

  it('部署失败（409）时把 details.errors 一次列全', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    deployApi.mockRejectedValue({
      code: 'ADM_DEPLOY_VALIDATION_FAILED',
      message: 'x',
      details: {
        errors: [
          { user_id: 'admin', agent_name: 'demo', category: 'target_writable', code: 'ADM_DEPLOY_TARGET_NOT_WRITABLE', message: '目标不可写' },
        ],
      },
    })
    const wrapper = mountPanel()
    await flushPromises()

    await validateButton(wrapper)?.trigger('click')
    await flushPromises()
    await deployButton(wrapper)?.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('目标不可写')
  })
})
