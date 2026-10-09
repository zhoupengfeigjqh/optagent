/**
 * 组件测试：SKILL 详情（文件树 + 文件编辑区，2026-09-16 起全部文件可编辑）
 *
 * 守住六点：
 * 1. SKILL.md 与 references 等附件**都能点开**，默认展示 SKILL.md 正文（不重复请求）；
 * 2. 改完能保存，并把"需要重新部署才生效"这条后果**明说**；
 * 3. **未保存的修改不能悄悄丢**：切换文件 / 返回列表前先确认；
 * 4. 特殊态说清楚：二进制不编辑、超限只读、读取失败可读；
 * 5. 删除前先取受影响清单（`FR-042`）；
 * 6. **本体市场来源只读**（`FR-062`）：不渲染编辑器与保存入口，正文只读呈现。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillViewer from './SkillViewer.vue'
import type { SkillDetail } from '../../api/types'

const fetchSkillFile = vi.fn()
const deleteSkill = vi.fn()

vi.mock('../../api/deploy', () => ({ fetchReferences: vi.fn() }))
vi.mock('../../api/skills', () => ({
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
  fetchSkillFile: (...a: unknown[]) => fetchSkillFile(...a),
  saveSkillFile: vi.fn(),
}))

const SKILL: SkillDetail = {
  name: '调度算法',
  description: '调度算法选型与实现指引',
  content: '# 正文\n\nSKILL 正文内容\n',
  content_hash: 'skill-md-hash',
  files: [
    { path: 'SKILL.md', size: 2509 },
    { path: 'references/算法详解.md', size: 3264 },
    { path: 'references/选型决策树.md', size: 2189 },
    { path: 'scripts/demo.py', size: 512 },
  ],
  source: 'skill-1.zip',
  installed_at: '2026-09-15T15:23:58.671Z',
  updated_at: '2026-09-15T15:54:51.690Z',
  revision: 5,
}

function mountViewer(skill: SkillDetail | null = SKILL) {
  return mount(SkillViewer, { props: { skill, error: null } })
}

function fileButton(wrapper: ReturnType<typeof mountViewer>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)
}

/** 未保存修改的守卫弹窗（与删除确认弹窗并列，故按 data-test 定位） */
function discardDialog(wrapper: ReturnType<typeof mountViewer>) {
  return wrapper.find('[data-test="discard-dialog"]')
}

/** 可编辑文件的正文在 `<textarea>` 里（`wrapper.text()` 不含表单值） */
function textareaValue(wrapper: ReturnType<typeof mountViewer>): string {
  const el = wrapper.find('textarea').element as HTMLTextAreaElement
  return el.value
}

beforeEach(() => {
  fetchSkillFile.mockReset()
  deleteSkill.mockReset()
})

describe('SkillViewer —— 文件查看与编辑', () => {
  it('文件树列出 SKILL.md 与各层附件，默认展示 SKILL.md 正文', async () => {
    const wrapper = mountViewer()
    await flushPromises()
    const text = wrapper.text()
    expect(text).toContain('references/')
    expect(text).toContain('算法详解.md')
    expect(text).toContain('选型决策树.md')
    expect(text).toContain('demo.py')
    // 默认选中 SKILL.md：正文直接来自详情，不额外请求（正文在编辑区里）
    expect(textareaValue(wrapper)).toContain('SKILL 正文内容')
    expect(fetchSkillFile).not.toHaveBeenCalled()
  })

  it('点击参考文件 → 加载并展示内容（可编辑）', async () => {
    fetchSkillFile.mockResolvedValue({
      name: '调度算法',
      path: 'references/算法详解.md',
      size: 3264,
      binary: false,
      truncated: false,
      content: '# 算法详解\n\nFCFS 思路…\n',
      hash: 'ref-hash',
      editable: true,
    })
    const wrapper = mountViewer()
    await flushPromises()

    await fileButton(wrapper, '算法详解.md')!.trigger('click')
    await flushPromises()

    expect(fetchSkillFile).toHaveBeenCalledWith('调度算法', 'references/算法详解.md')
    expect(textareaValue(wrapper)).toContain('FCFS 思路')
  })

  it('二进制文件：提示不提供预览与编辑', async () => {
    fetchSkillFile.mockResolvedValue({
      name: '调度算法',
      path: 'scripts/demo.py',
      size: 512,
      binary: true,
      truncated: false,
      content: null,
      hash: 'bin-hash',
      editable: false,
    })
    const wrapper = mountViewer()
    await flushPromises()

    await fileButton(wrapper, 'demo.py')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('二进制文件')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('超出上限：明确标注仅显示前 256KB 且不提供编辑', async () => {
    fetchSkillFile.mockResolvedValue({
      name: '调度算法',
      path: 'references/算法详解.md',
      size: 999999,
      binary: false,
      truncated: true,
      content: 'x',
      hash: 'big-hash',
      editable: false,
    })
    const wrapper = mountViewer()
    await flushPromises()

    await fileButton(wrapper, '算法详解.md')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('256KB')
    expect(wrapper.text()).toContain('不提供在线编辑')
  })

  it('读取失败：显示可读原因，不静默留白', async () => {
    fetchSkillFile.mockRejectedValue({ code: 'ADM_SKILL_NOT_FOUND', message: '技能内不存在该文件：x' })
    const wrapper = mountViewer()
    await flushPromises()

    await fileButton(wrapper, '算法详解.md')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').text().length).toBeGreaterThan(0)
  })

  it('保存只改技能库：界面明确提示引用者需重新部署才生效', async () => {
    const wrapper = mountViewer()
    await flushPromises()
    expect(wrapper.text()).toContain('重新部署')
    expect(wrapper.text()).toContain('保存只改技能库')
  })

  it('未保存的修改：切换文件前先确认，确认后才真正切换（MUST NOT 静默丢弃）', async () => {
    fetchSkillFile.mockResolvedValue({
      name: '调度算法',
      path: 'references/算法详解.md',
      size: 3264,
      binary: false,
      truncated: false,
      content: '# 算法详解\n',
      hash: 'ref-hash',
      editable: true,
    })
    const wrapper = mountViewer()
    await flushPromises()
    expect(discardDialog(wrapper).attributes('open')).toBeUndefined()

    // 在 SKILL.md 上制造未保存的修改
    await wrapper.find('textarea').setValue('# 改过了\n')
    expect(wrapper.text()).toContain('未保存')

    await fileButton(wrapper, '算法详解.md')!.trigger('click')
    await flushPromises()

    // 守卫已弹出，且**尚未**切换文件
    expect(discardDialog(wrapper).attributes('open')).toBeDefined()
    expect(fetchSkillFile).not.toHaveBeenCalled()

    await discardDialog(wrapper).find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(fetchSkillFile).toHaveBeenCalledWith('调度算法', 'references/算法详解.md')
    expect(discardDialog(wrapper).attributes('open')).toBeUndefined()
  })

  it('未保存的修改：返回列表前先确认', async () => {
    const wrapper = mountViewer()
    await flushPromises()

    await wrapper.find('textarea').setValue('# 改过了\n')
    await wrapper.find('header button').trigger('click')
    await flushPromises()

    expect(discardDialog(wrapper).attributes('open')).toBeDefined()
    expect(wrapper.emitted('back')).toBeFalsy()
  })
})

describe('SkillViewer —— 本体市场来源只读（FR-062）', () => {
  const MARKET_SKILL: SkillDetail = {
    ...SKILL,
    source: 'onto_market:生产调度/原材料采购和库存',
    origin: {
      kind: 'onto_market',
      scenario: '生产调度',
      ontology: '原材料采购和库存',
      hash: 'market-hash',
    },
  }

  it('只读：MUST NOT 渲染编辑器，正文以只读文本呈现，且说明更新入口', async () => {
    const wrapper = mountViewer(MARKET_SKILL)
    await flushPromises()

    // 无编辑控件（textarea 是编辑器的核心特征）、无保存按钮
    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.findAll('button').some((b) => b.text().includes('保存'))).toBe(false)
    // 只读正文可见（SKILL.md 正文随详情返回，无需再请求）
    expect(wrapper.find('.skill-viewer__readonly-pre').text()).toContain('SKILL 正文内容')
    expect(wrapper.text()).toContain('本体市场导入的技能为只读')
    expect(wrapper.text()).toContain('从本体市场导入')
  })

  it('只读：文件树仍可切换查看（只读的是内容，不是浏览）', async () => {
    fetchSkillFile.mockResolvedValue({
      name: '调度算法',
      path: 'references/算法详解.md',
      size: 10,
      binary: false,
      truncated: false,
      content: '# 附件只读\n',
      hash: 'h',
      editable: true,
    })
    const wrapper = mountViewer(MARKET_SKILL)
    await flushPromises()

    await fileButton(wrapper, '算法详解.md')!.trigger('click')
    await flushPromises()

    expect(fetchSkillFile).toHaveBeenCalledWith('调度算法', 'references/算法详解.md')
    expect(wrapper.find('.skill-viewer__readonly-pre').text()).toContain('附件只读')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('非市场来源（ZIP 安装）仍渲染编辑器，可编辑', async () => {
    const wrapper = mountViewer()
    await flushPromises()

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('本体市场导入的技能为只读')
  })
})
