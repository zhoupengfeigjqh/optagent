import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeploy } from './useDeploy'

const fetchManifest = vi.fn()
const deployApi = vi.fn()

vi.mock('../api/deploy', () => ({
  deploy: (...a: unknown[]) => deployApi(...a),
  fetchReferences: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: (...a: unknown[]) => fetchManifest(...a),
}))

beforeEach(() => {
  fetchManifest.mockReset().mockResolvedValue({ items: [], total: 0, revision: 7 })
  deployApi.mockReset()
})

describe('useDeploy', () => {
  it('loadRevision：写入清单端点返回的 revision', async () => {
    const d = useDeploy()
    await d.loadRevision()

    expect(d.revision.value).toBe(7)
  })

  it('loadRevision 失败：错误可读，不抛出', async () => {
    fetchManifest.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const d = useDeploy()
    await d.loadRevision()
    expect(d.error.value?.code).toBe('ADM_STORAGE_UNAVAILABLE')
  })

  it('deploy：提交前读一次版本，成功后不再额外刷新（部署不写设计态，版本不会变）', async () => {
    deployApi.mockResolvedValue({ users: [], manifest_diff: [], history_id: 'h1' })

    const d = useDeploy()
    expect(await d.deploy(['admin'])).toBe(true)
    expect(fetchManifest).toHaveBeenCalledTimes(1)
    expect(deployApi).toHaveBeenCalledWith(['admin'], 7)
    expect(d.result.value?.history_id).toBe('h1')
    expect(d.revision.value).toBe(7)
  })

  it('deploy：版本未加载时先自动加载（避免用 revision=0 提交）', async () => {
    deployApi.mockResolvedValue({ users: [], manifest_diff: [], history_id: 'h' })
    const d = useDeploy()
    await d.deploy(['admin'])

    expect(fetchManifest).toHaveBeenCalled()
    expect(deployApi).toHaveBeenCalledWith(['admin'], 7)
  })

  it('2026-11-17：部署前总是取最新 revision（别处改过配置不再被陈旧版本卡住）', async () => {
    fetchManifest.mockResolvedValueOnce({ items: [], total: 0, revision: 5 })
    const d = useDeploy()
    await d.loadRevision()
    fetchManifest.mockResolvedValue({ items: [], total: 0, revision: 6 })
    deployApi.mockResolvedValue({ users: [], manifest_diff: [], history_id: 'h' })

    expect(await d.deploy(['admin'])).toBe(true)
    expect(deployApi).toHaveBeenCalledWith(['admin'], 6)
  })

  it('2026-11-23：某用户失败（200 + users[].ok=false）仍算本次请求完成，失败原因在结果里', async () => {
    deployApi.mockResolvedValue({
      users: [
        { user_id: 'admin', ok: true, agents: [{ name: 'demo', action: 'written', ok: true }] },
        { user_id: 'ops', ok: false, agents: [], error: '引用的 SKILL 已删除' },
      ],
      manifest_diff: [],
      history_id: 'h2',
    })
    const d = useDeploy()

    expect(await d.deploy(['admin', 'ops'])).toBe(true)
    expect(d.result.value?.users).toHaveLength(2)
    expect(d.result.value?.users[1]?.error).toBe('引用的 SKILL 已删除')
  })

  it('deploy 失败：错误可读（不再有错误清单可解析）', async () => {
    deployApi.mockRejectedValue({ code: 'ADM_DEPLOY_TARGET_NOT_WRITABLE', message: 'x' })
    const d = useDeploy()
    await d.loadRevision()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(d.error.value?.code).toBe('ADM_DEPLOY_TARGET_NOT_WRITABLE')
  })

  it('部署失败后不再重读版本（下一次提交前的那次读取已足够，2026-11-23）', async () => {
    deployApi.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const d = useDeploy()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(fetchManifest).toHaveBeenCalledTimes(1)
    expect(d.revision.value).toBe(7)
    expect(d.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
  })

  it('版本读不到 → 不发部署请求，错误为真实原因（不再以 revision=0 提交被 409 误导）', async () => {
    fetchManifest.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const d = useDeploy()

    expect(await d.deploy(['admin'])).toBe(false)
    expect(deployApi).not.toHaveBeenCalled()
    expect(d.error.value?.code).toBe('ADM_STORAGE_UNAVAILABLE')
  })

  it('2026-10-20：整批 404 时把 `details.user_ids` 暴露给界面（指出是哪几个用户）', async () => {
    deployApi.mockRejectedValue({
      code: 'ADM_USER_NOT_FOUND',
      message: 'x',
      details: { user_ids: ['ghost1', 'ghost2'] },
    })
    const d = useDeploy()
    await d.loadRevision()

    expect(await d.deploy(['admin', 'ghost1', 'ghost2'])).toBe(false)
    expect(d.unknownUserIds.value).toEqual(['ghost1', 'ghost2'])
    expect(d.error.value?.code).toBe('ADM_USER_NOT_FOUND')
  })
})

describe('部署对象：空选择一律拒绝（MUST NOT 落回"全部用户"）', () => {
  it('deploy：空数组 → 不调接口、返回 false（否则服务端会理解为"全部用户"）', async () => {
    const d = useDeploy()
    expect(await d.deploy([])).toBe(false)

    expect(deployApi).not.toHaveBeenCalled()
    expect(fetchManifest).not.toHaveBeenCalled()
    expect(d.error.value?.message).toContain('勾选')
  })
})
