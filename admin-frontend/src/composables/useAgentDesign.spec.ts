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
  next_action_hints: false,
  next_action_hints_count: 3,
}

const DESIGN = {
  name: 'demo',
  soul: SOUL,
  enabled_tools: ['read_file'],
  mcp_services: ['ocr'],
  skills: [],
  ontologies: [],
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
        next_action_hints: false,
        next_action_hints_count: 3,
      },
      enabled_tools: [],
      mcp_services: [],
      skills: [],
      ontologies: [],
      scenario: {
        scenario: '',
        data_prep_dirs: ['算法规则'],
        data_prep_fields: {},
        data_prep_uploads: {},
      },
    })
  })

  it('本体引用是草稿的一部分：默认空数组（2026-10-17）', () => {
    expect(emptyDraft().ontologies).toEqual([])
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

  it('dirty（007）：只把提示条数从缺省改成别的值，也算已修改（逐字段比较）', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    expect(editor.dirty.value).toBe(false)

    editor.draft.value.soul = { ...editor.draft.value.soul, next_action_hints_count: 5 }

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

  /* ---------- 2026-10-13：目录级可上传类型（FR-005） ---------- */

  it('load：未配置该键的数字人草稿归一为 `{}`（不产生 undefined）', async () => {
    const editor = useAgentDesign()
    await editor.load('demo')
    expect(editor.draft.value.scenario.data_prep_uploads).toEqual({})
    expect(editor.dirty.value).toBe(false)
  })

  it('可上传类型是**深副本**：改草稿里的数组不污染已保存态', async () => {
    getAgent.mockResolvedValue({
      ...DESIGN,
      scenario: { ...DESIGN.scenario, data_prep_uploads: { 生产计划: ['.csv', '.xlsx'] } },
    })
    const editor = useAgentDesign()
    await editor.load('demo')

    editor.draft.value.scenario.data_prep_uploads!['生产计划'].push('.txt')
    editor.draft.value.scenario.data_prep_uploads!['新增目录'] = ['.json']

    expect(editor.dirty.value).toBe(true)
    expect(editor.saved.value?.scenario.data_prep_uploads).toEqual({ 生产计划: ['.csv', '.xlsx'] })
  })

  it('可上传类型的改动触发 dirty（即便场景名与字段约束未变）', async () => {
    getAgent.mockResolvedValue({
      ...DESIGN,
      scenario: { ...DESIGN.scenario, data_prep_uploads: { 生产计划: ['.csv'] } },
    })
    const editor = useAgentDesign()
    await editor.load('demo')
    expect(editor.dirty.value).toBe(false)

    editor.draft.value.scenario.data_prep_uploads!['生产计划'] = ['.csv', '.txt']
    expect(editor.dirty.value).toBe(true)
  })

  it('dirty：新建态下仅配置了可上传类型即视为已修改', () => {
    const editor = useAgentDesign()
    editor.draft.value.scenario.data_prep_uploads!['算法规则'] = ['.json']
    expect(editor.dirty.value).toBe(true)
  })

  it('save 带上可上传类型（深副本，避免草稿后续改动污染载荷）', async () => {
    createAgent.mockResolvedValue({ ...DESIGN, name: 'demo2', revision: 1 })
    const editor = useAgentDesign()
    editor.draft.value.name = 'demo2'
    editor.draft.value.scenario.data_prep_uploads!['算法规则'] = ['.json']

    await editor.save()
    const payload = createAgent.mock.calls[0][0] as {
      scenario: { data_prep_uploads: Record<string, string[]> }
    }
    expect(payload.scenario.data_prep_uploads).toEqual({ 算法规则: ['.json'] })
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

  it('带复制源：提示条数一并带走（`cloneSoul` 的字段清单是契约，漏了就整片丢失）', async () => {
    getAgent.mockResolvedValue({
      ...DESIGN,
      soul: { ...SOUL, next_action_hints: true, next_action_hints_count: 5 },
    })
    const editor = useAgentDesign()
    await editor.resetToCopy('副本', 'demo')

    expect(editor.draft.value.soul.next_action_hints).toBe(true)
    expect(editor.draft.value.soul.next_action_hints_count).toBe(5)
  })

  it('复制源缺提示条数（老存档）：兜底为缺省值，不把 `undefined` 带进草稿', async () => {
    const legacy = { ...SOUL } as Partial<typeof SOUL>
    delete legacy.next_action_hints_count
    getAgent.mockResolvedValue({ ...DESIGN, soul: legacy })
    const editor = useAgentDesign()
    await editor.resetToCopy('副本', 'demo')

    expect(editor.draft.value.soul.next_action_hints_count).toBe(3)
  })

  it('问题实例（starters）逐层深拷贝：改草稿的提示文本与关联工具都不污染源', async () => {
    // 嵌套两层（问题实例 → 关联工具），浅拷贝会让弹窗里的编辑直接改到"已保存态"
    interface StarterLike {
      prompt: string
      tools: Array<{ kind: 'builtin' | 'mcp'; name: string; service?: string }>
    }
    const starters: StarterLike[] = [
      {
        prompt: '看生产计划',
        tools: [
          { kind: 'builtin', name: 'read_file' },
          { kind: 'mcp', name: 'ocr_detect', service: 'ocr' },
        ],
      },
    ]
    getAgent.mockResolvedValue({ ...DESIGN, soul: { ...SOUL, starters } })
    const editor = useAgentDesign()
    await editor.resetToCopy('副本', 'demo')

    expect(editor.draft.value.soul.starters).toEqual(starters)

    editor.draft.value.soul.starters[0]!.prompt = '改过了'
    editor.draft.value.soul.starters[0]!.tools[0]!.name = 'write_file'
    editor.draft.value.soul.starters[0]!.tools.push({ kind: 'builtin', name: 'list_files' })

    expect(starters[0]!.prompt).toBe('看生产计划')
    expect(starters[0]!.tools[0]!.name).toBe('read_file')
    expect(starters[0]!.tools).toHaveLength(2)
  })
})
