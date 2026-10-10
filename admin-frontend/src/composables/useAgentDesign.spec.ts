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

/** 结构化 SOUL 夹具（004）：必填项齐全，测试按需 spread 覆盖 */
const SOUL = {
  intro: '简介',
  welcome: '欢迎',
  starters: [],
  mission: '你是助手',
  capability_tags: [],
  forbidden: [],
  prompt_extra: '',
}

const DESIGN = {
  name: 'demo',
  soul: SOUL,
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  scenario: {
    scenario: '生产',
    data_prep_dirs: ['生产计划'],
    data_prep_fields: { 生产计划: [{ name: '产线编号', type: 'string', required: true }] },
  },
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
      soul: {
        intro: '',
        welcome: '',
        starters: [],
        mission: '',
        capability_tags: [],
        forbidden: [],
        prompt_extra: '',
      },
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      scenario: { scenario: '', data_prep_dirs: ['算法规则'], data_prep_fields: {} },
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
    expect(editor.draft.value.soul.mission).toBe('你是助手')
    expect(editor.dirty.value).toBe(false)
  })

  it('load 用**副本**填充草稿：改动草稿不污染已保存态（dirty 判定可靠）', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.enabled_tools.push('write_file')

    expect(editor.dirty.value).toBe(true)
    expect(editor.saved.value?.enabled_tools).toEqual(['read_file'])
  })

  it('字段约束是**深副本**：改草稿里的字段不污染已保存态', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.scenario.data_prep_fields.生产计划.push({
      name: '计划量',
      type: 'integer',
      required: false,
    })

    expect(editor.dirty.value).toBe(true)
    expect(editor.saved.value?.scenario.data_prep_fields.生产计划).toHaveLength(1)
  })

  it('字段约束的改动也触发 dirty（即便目录与场景名未变）', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.scenario.data_prep_fields.生产计划[0].required = false
    expect(editor.dirty.value).toBe(true)
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
    editor.draft.value.soul = { ...SOUL, mission: 'x' }
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
    updateAgent.mockResolvedValue({ ...DESIGN, soul: { ...SOUL, mission: '改后' }, revision: 4 })
    const editor = useAgentDesign()
    await editor.load('demo')
    editor.draft.value.soul = { ...SOUL, mission: '改后' }

    await editor.save()
    expect(updateAgent).toHaveBeenCalledWith('demo', expect.objectContaining({ revision: 3 }))
    expect(editor.revision.value).toBe(4)
    expect(editor.draft.value.soul.mission).toBe('改后')
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

  it('使命原样填充草稿（含换行与标点，不额外 trim；FR-017 / 004）', async () => {
    const mission = '第一行\n第二行，含标点！？\n\n'
    getAgent.mockResolvedValue({ ...DESIGN, soul: { ...SOUL, mission } })
    const editor = useAgentDesign()
    await editor.load('demo')
    expect(editor.draft.value.soul.mission).toBe(mission)
  })
})

describe('resetToCopy —— 「新建数字人」弹窗的预填（FR-015，2026-10-09）', () => {
  it('无复制源：只预填名称，五类配置为全新初始值', async () => {
    const editor = useAgentDesign()
    expect(await editor.resetToCopy('新助手', null)).toBeNull()

    expect(editor.draft.value).toEqual({ ...emptyDraft(), name: '新助手' })
    expect(getAgent).not.toHaveBeenCalled()
    expect(editor.isNew.value).toBe(true)
  })

  it('带复制源：五类配置取自源、名称取新名，且仍是**新建态**（保存走 POST）', async () => {
    createAgent.mockResolvedValue({ ...DESIGN, name: '副本', revision: 1 })
    const editor = useAgentDesign()
    expect(await editor.resetToCopy('副本', 'demo')).toBeNull()

    expect(getAgent).toHaveBeenCalledWith('demo')
    expect(editor.draft.value.name).toBe('副本')
    expect(editor.draft.value.soul.mission).toBe('你是助手')
    expect(editor.draft.value.enabled_tools).toEqual(['read_file'])
    expect(editor.draft.value.mcp_services).toEqual(['ocr'])
    expect(editor.draft.value.scenario.scenario).toBe('生产')

    // 复制出来的是"尚未保存的新建态"：revision 必须为 null，保存走 POST（而非 PUT）
    expect(editor.revision.value).toBeNull()
    expect(editor.isNew.value).toBe(true)
    await editor.save()
    expect(createAgent).toHaveBeenCalledTimes(1)
    expect(updateAgent).not.toHaveBeenCalled()
  })

  it('复制草稿是**深副本**：改草稿不污染源，源也不被当作"已保存态"', async () => {
    const editor = useAgentDesign()
    await editor.resetToCopy('副本', 'demo')

    editor.draft.value.enabled_tools.push('write_file')
    editor.draft.value.scenario.data_prep_fields.生产计划.push({
      name: '计划量',
      type: 'integer',
      required: false,
    })

    expect(editor.saved.value).toBeNull()
    expect(editor.dirty.value).toBe(true)
  })

  it('复制源读取失败：降级为空草稿 + 保留名称，返回可读原因且不写 error', async () => {
    getAgent.mockRejectedValue({ code: 'ADM_AGENT_NOT_FOUND', message: 'raw backend msg' })
    const editor = useAgentDesign()

    const failure = await editor.resetToCopy('副本', 'gone')

    expect(failure).toContain('ADM_AGENT_NOT_FOUND')
    expect(failure).not.toContain('raw backend msg')
    expect(editor.draft.value.name).toBe('副本')
    expect(editor.draft.value.soul.mission).toBe('')
    expect(editor.isNew.value).toBe(true)
    expect(editor.loading.value).toBe(false)
    // error 专表"保存未完成"：降级原因由调用方播报，不占用它
    expect(editor.error.value).toBeNull()
  })
})
