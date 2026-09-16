/**
 * 单元测试：数字人设计态编辑状态（US1）
 *
 * 重点：`revision === null` 即"新建"，保存走 POST，否则走 PUT（带乐观锁）；
 * 以及 `dirty` 的判定（离开前提示的依据）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyDraft, useAgentDesign } from './useAgentDesign'

const getAgent = vi.fn()
const createAgent = vi.fn()
const updateAgent = vi.fn()

vi.mock('../api/agents', () => ({
  getAgent: (...a: unknown[]) => getAgent(...a),
  createAgent: (...a: unknown[]) => createAgent(...a),
  updateAgent: (...a: unknown[]) => updateAgent(...a),
  listAgents: vi.fn(),
  deleteAgent: vi.fn(),
}))

const DESIGN = {
  name: 'demo',
  soul: '你是助手',
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: { scenario: '生产', data_prep_dirs: ['生产计划'] },
  abnormal: false,
  abnormal_reason: null,
  updated_at: '2026-09-15T00:00:00.000Z',
  revision: 3,
}

beforeEach(() => {
  getAgent.mockReset().mockResolvedValue(DESIGN)
  createAgent.mockReset()
  updateAgent.mockReset()
})

describe('emptyDraft', () => {
  it('初值为五类配置齐全的空草稿（MUST NOT 缺字段）', () => {
    expect(emptyDraft()).toEqual({
      name: '',
      soul: '',
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      scenario: { scenario: '', data_prep_dirs: [] },
    })
  })
})

describe('useAgentDesign', () => {
  it('新建态：isNew 为真，草稿为初始值', () => {
    const editor = useAgentDesign()
    expect(editor.isNew.value).toBe(true)
    expect(editor.dirty.value).toBe(false)
    expect(editor.revision.value).toBeNull()
  })

  it('load：写入草稿与 revision，并退出新建态', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')

    expect(getAgent).toHaveBeenCalledWith('demo')
    expect(editor.isNew.value).toBe(false)
    expect(editor.revision.value).toBe(3)
    expect(editor.draft.value.soul).toBe('你是助手')
    expect(editor.dirty.value).toBe(false)
  })

  it('load 用**副本**填充草稿：改动草稿不污染已保存态（dirty 判定可靠）', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.enabled_tools.push('write_file')

    expect(editor.dirty.value).toBe(true)
    expect(editor.saved.value?.enabled_tools).toEqual(['read_file'])
  })

  it('load 失败：错误可读且回到未加载状态', async () => {
    getAgent.mockRejectedValue({ code: 'ADM_AGENT_NOT_FOUND', message: 'x' })
    const editor = useAgentDesign()
    await editor.load('ghost')

    expect(editor.error.value?.code).toBe('ADM_AGENT_NOT_FOUND')
    expect(editor.saved.value).toBeNull()
    expect(editor.revision.value).toBeNull()
    expect(editor.loading.value).toBe(false)
  })

  it('dirty：新建态下有任意输入即视为已修改', () => {
    const editor = useAgentDesign()
    editor.draft.value.soul = 'x'
    expect(editor.dirty.value).toBe(true)
  })

  it('save（新建）：走 POST，成功后 revision 被赋值', async () => {
    createAgent.mockResolvedValue({ ...DESIGN, name: 'demo2', revision: 1 })
    const editor = useAgentDesign()
    editor.draft.value.name = 'demo2'

    const saved = await editor.save()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(updateAgent).not.toHaveBeenCalled()
    expect(saved?.name).toBe('demo2')
    expect(editor.isNew.value).toBe(false)
    expect(editor.revision.value).toBe(1)
    expect(editor.dirty.value).toBe(false)
  })

  it('save（编辑）：走 PUT 并带上 revision（乐观锁）', async () => {
    updateAgent.mockResolvedValue({ ...DESIGN, soul: '改后', revision: 4 })
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.soul = '改后'

    await editor.save()
    expect(updateAgent).toHaveBeenCalledWith('demo', expect.objectContaining({ revision: 3 }))
    expect(editor.revision.value).toBe(4)
    expect(editor.draft.value.soul).toBe('改后')
  })

  it('save 失败：返回 null、错误按码可读、revision 不变（不误以为已保存）', async () => {
    updateAgent.mockRejectedValue({ code: 'ADM_CONFIG_REVISION_CONFLICT', message: 'x' })
    const editor = useAgentDesign()
    await editor.load('demo')

    expect(await editor.save()).toBeNull()
    expect(editor.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
    expect(editor.revision.value).toBe(3)
    expect(editor.saving.value).toBe(false)
  })

  it('resetToNew：清空草稿与错误，回到新建态', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.resetToNew()

    expect(editor.isNew.value).toBe(true)
    expect(editor.draft.value).toEqual(emptyDraft())
    expect(editor.saved.value).toBeNull()
    expect(editor.dirty.value).toBe(false)
  })

  it('soul 原样保留（含换行与标点，不 trim；FR-017）', async () => {
    const soul = '第一行\n第二行，含标点！？\n\n'
    getAgent.mockResolvedValue({ ...DESIGN, soul })
    const editor = useAgentDesign()
    await editor.load('demo')
    expect(editor.draft.value.soul).toBe(soul)
  })
})
