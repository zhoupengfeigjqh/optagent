/**
 * 单元测试：部署状态（US2）
 *
 * 重点守住两件事：
 * 1. `SC-020`：部署失败（409）时 MUST 把 `details.errors` **一次性列全**，
 *    而不是只留第一条；
 * 2. **空选择一律拒绝**（2026-09-16）：部署对象在用户卡片上勾选后传进来，
 *    空数组若要落回服务端"缺省 = 全部用户"，就会变成误部署全平台。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeploy } from './useDeploy'

const fetchSettings = vi.fn()
const fetchRuntimeForms = vi.fn()
const saveSettings = vi.fn()
const validateDeploy = vi.fn()
const deployApi = vi.fn()

vi.mock('../api/platform', () => ({
  fetchSettings: (...a: unknown[]) => fetchSettings(...a),
  fetchRuntimeForms: (...a: unknown[]) => fetchRuntimeForms(...a),
  saveSettings: (...a: unknown[]) => saveSettings(...a),
  fetchHealth: vi.fn(),
}))

vi.mock('../api/deploy', () => ({
  validateDeploy: (...a: unknown[]) => validateDeploy(...a),
  deploy: (...a: unknown[]) => deployApi(...a),
  fetchReferences: vi.fn(),
  fetchAnomalies: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
}))

beforeEach(() => {
  fetchSettings.mockReset().mockResolvedValue({ target_runtime_form: 'container_network', revision: 7 })
  fetchRuntimeForms.mockReset().mockResolvedValue({
    items: [
      { value: 'container_network', label: '容器编排内网' },
      { value: 'host_local', label: '宿主机本地' },
    ],
  })
  saveSettings.mockReset()
  validateDeploy.mockReset()
  deployApi.mockReset()
})

describe('useDeploy', () => {
  it('loadSettings：写入设置与形态枚举，并给出中文标签', async () => {
    const d = useDeploy()
    await d.loadSettings()

    expect(d.settings.value?.revision).toBe(7)
    expect(d.forms.value).toHaveLength(2)
    expect(d.targetFormLabel.value).toBe('容器编排内网')
  })

  it('loadSettings 失败：错误可读，不抛出', async () => {
    fetchSettings.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const d = useDeploy()
    await d.loadSettings()
    expect(d.error.value?.code).toBe('ADM_STORAGE_UNAVAILABLE')
  })

  it('validate：通过时记录"已验证"且错误清单为空，并把勾选用户传给服务端', async () => {
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    const d = useDeploy()
    await d.validate(['admin'])

    expect(validateDeploy).toHaveBeenCalledWith(['admin'])
    expect(d.validated.value).toBe(true)
    expect(d.validationErrors.value).toEqual([])
    expect(d.validating.value).toBe(false)
  })

  it('validate：不通过时**一次列全**全部错误项（SC-020）', async () => {
    validateDeploy.mockResolvedValue({
      passed: false,
      errors: [
        { user_id: 'a', agent_name: 'x', category: 'runtime_form', code: 'X', message: 'm1' },
        { user_id: 'b', agent_name: 'y', category: 'reference_validity', code: 'Y', message: 'm2' },
      ],
    })
    const d = useDeploy()
    await d.validate(['admin'])

    expect(d.validationErrors.value).toHaveLength(2)
  })

  it('validate 失败（接口本身报错）：错误可读', async () => {
    validateDeploy.mockRejectedValue({ code: 'ADM_RUNTIME_UNREACHABLE', message: 'x' })
    const d = useDeploy()
    await d.validate(['admin'])

    expect(d.error.value?.code).toBe('ADM_RUNTIME_UNREACHABLE')
  })

  it('deploy：成功时写入结果、清空校验态并刷新 revision', async () => {
    deployApi.mockResolvedValue({
      target_runtime_form: 'container_network',
      users: [],
      manifest_diff: [],
      history_id: 'h1',
    })
    fetchSettings.mockResolvedValue({ target_runtime_form: 'container_network', revision: 8 })

    const d = useDeploy()
    expect(await d.deploy(['admin'])).toBe(true)
    // 设置未加载 → 先取到 revision=8 再提交（不是用陈旧的 0）
    expect(deployApi).toHaveBeenCalledWith(['admin'], 8)
    expect(d.result.value?.history_id).toBe('h1')
    expect(d.validationErrors.value).toEqual([])
    expect(d.validated.value).toBe(false)
    expect(d.settings.value?.revision).toBe(8)
  })

  it('deploy：设置未加载时先自动加载（避免用 revision=0 提交）', async () => {
    deployApi.mockResolvedValue({ target_runtime_form: 'x', users: [], manifest_diff: [], history_id: 'h' })
    const d = useDeploy()
    await d.deploy(['admin'])

    expect(fetchSettings).toHaveBeenCalled()
    expect(deployApi).toHaveBeenCalledWith(['admin'], 7)
  })

  it('deploy 失败：把 details.errors 一次列全（SC-020）', async () => {
    deployApi.mockRejectedValue({
      code: 'ADM_DEPLOY_VALIDATION_FAILED',
      message: 'x',
      details: {
        errors: [
          { user_id: 'a', agent_name: 'x', category: 'c', code: 'X', message: 'm1' },
          { user_id: 'b', agent_name: 'y', category: 'c', code: 'Y', message: 'm2' },
        ],
      },
    })
    const d = useDeploy()
    await d.loadSettings()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(deployApi).toHaveBeenCalledWith(['admin'], 7)
    expect(d.validationErrors.value).toHaveLength(2)
    expect(d.error.value?.code).toBe('ADM_DEPLOY_VALIDATION_FAILED')
  })

  it('deploy 失败但无 details.errors：错误可读且不伪造错误清单', async () => {
    deployApi.mockRejectedValue({ code: 'ADM_RUNTIME_FORM_NOT_CONFIGURED', message: 'x' })
    const d = useDeploy()
    await d.loadSettings()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(d.validationErrors.value).toEqual([])
    expect(d.error.value?.code).toBe('ADM_RUNTIME_FORM_NOT_CONFIGURED')
  })

  it('switchForm：切换成功后同步新 revision（FR-057）', async () => {
    saveSettings.mockResolvedValue({ target_runtime_form: 'host_local', revision: 8, deploy_required: true })
    const d = useDeploy()
    await d.loadSettings()

    expect(await d.switchForm('host_local')).toBe(true)
    expect(saveSettings).toHaveBeenCalledWith('host_local', 7)
    expect(d.settings.value).toEqual({ target_runtime_form: 'host_local', revision: 8 })
  })

  it('targetFormLabel：设置未加载时显示占位符（不显示 undefined）', () => {
    expect(useDeploy().targetFormLabel.value).toBe('—')
  })

  it('targetFormLabel：形态不在枚举中时回退占位符（后端新增形态的前后兼容）', async () => {
    fetchSettings.mockResolvedValue({ target_runtime_form: 'brand_new_form', revision: 1 })
    const d = useDeploy()
    await d.loadSettings()
    expect(d.targetFormLabel.value).toBe('—')
  })

  it('设置不可得时部署以 revision=0 提交（交由后端以版本冲突拒绝，而不是静默用旧版本）', async () => {
    fetchSettings.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    deployApi.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const d = useDeploy()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(deployApi).toHaveBeenCalledWith(['admin'], 0)
    expect(d.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
  })

  it('switchForm 失败：返回 false 并可读报错（不静默改状态）', async () => {
    saveSettings.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const d = useDeploy()
    await d.loadSettings()

    expect(await d.switchForm('host_local')).toBe(false)
    expect(d.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
    expect(d.settings.value?.target_runtime_form).toBe('container_network')
  })
})

describe('部署对象：空选择一律拒绝（MUST NOT 落回"全部用户"）', () => {
  it('validate：空数组 → 不调接口，给出可读报错', async () => {
    const d = useDeploy()
    await d.validate([])

    expect(validateDeploy).not.toHaveBeenCalled()
    expect(d.validated.value).toBe(false)
    expect(d.error.value?.message).toContain('勾选')
  })

  it('deploy：空数组 → 不调接口、返回 false（否则服务端会理解为"全部用户"）', async () => {
    const d = useDeploy()
    expect(await d.deploy([])).toBe(false)

    expect(deployApi).not.toHaveBeenCalled()
    expect(fetchSettings).not.toHaveBeenCalled()
    expect(d.error.value?.message).toContain('勾选')
  })

  it('目标运行形态切换 → 上一次预检作废（第⑤类结论会变）', async () => {
    saveSettings.mockResolvedValue({
      target_runtime_form: 'host_local',
      revision: 8,
      deploy_required: true,
    })
    validateDeploy.mockResolvedValue({ passed: true, errors: [] })
    const d = useDeploy()
    await d.loadSettings()
    await d.validate(['admin'])
    expect(d.validated.value).toBe(true)

    await d.switchForm('host_local')
    expect(d.validated.value).toBe(false)
  })

  it('invalidateValidation：勾选变化后由界面调用，用于作废上一次结论', async () => {
    validateDeploy.mockResolvedValue({
      passed: false,
      errors: [{ user_id: 'a', agent_name: 'x', category: 'c', code: 'X', message: 'm' }],
    })
    const d = useDeploy()
    await d.validate(['admin'])
    expect(d.validated.value).toBe(true)
    expect(d.validationErrors.value).toHaveLength(1)

    d.invalidateValidation()
    expect(d.validated.value).toBe(false)
    expect(d.validationErrors.value).toEqual([])
  })
})
