/**
 * 组件测试：技能文件编辑区（2026-09-16：全部文件可编辑，含附件）
 *
 * 守住五件事：
 * 1. 文本文件可编辑并可保存——保存**必须**带上读取时的哈希（服务端据此判冲突）；
 * 2. 二进制与超限文件**不给编辑入口**，并说明原因（避免"点了就丢内容"）；
 * 3. 内容已被他处修改（409）→ 可读提示 + 「重新加载最新内容」，不静默覆盖；
 * 4. "未保存/已保存"的状态如实回传（父组件据此做离开守卫）；
 * 5. **保存前二次确认**：保存不可逆（库中不留副本），取消即不写入且草稿保留。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillFileEditor from './SkillFileEditor.vue'
import type { SkillFileContent } from '../../api/types'

const saveSkillFile = vi.fn()

vi.mock('../../api/skills', () => ({
  saveSkillFile: (...args: unknown[]) => saveSkillFile(...args),
}))

function file(overrides: Partial<SkillFileContent> = {}): SkillFileContent {
  return {
    name: 'pdf-parse',
    path: 'references/手册.md',
    size: 12,
    binary: false,
    truncated: false,
    content: '# 手册\n',
    hash: 'h1',
    editable: true,
    ...overrides,
  }
}

function mountEditor(input: SkillFileContent | null) {
  return mount(SkillFileEditor, { props: { file: input, loading: false, error: null } })
}

function saveButton(wrapper: ReturnType<typeof mountEditor>) {
  return wrapper.findAll('button').find((button) => button.text().startsWith('保存'))
}

/** 保存的二次确认弹窗（与「放弃修改」区分：按 data-test 定位） */
function saveDialog(wrapper: ReturnType<typeof mountEditor>) {
  return wrapper.find('[data-test="save-dialog"]')
}

/** 走完整保存路径：点「保存」→ 确认 → 真正写库（保存不可逆，必须先确认） */
async function saveViaDialog(wrapper: ReturnType<typeof mountEditor>) {
  await saveButton(wrapper)!.trigger('click')
  await saveDialog(wrapper).find('[data-test="confirm"]').trigger('click')
  await flushPromises()
}

beforeEach(() => {
  saveSkillFile.mockReset()
})

describe('SkillFileEditor —— 编辑与保存', () => {
  it('文本文件：可编辑、可保存，保存带内容与 base_hash', async () => {
    saveSkillFile.mockResolvedValue({
      name: 'pdf-parse',
      path: 'references/手册.md',
      size: 9,
      hash: 'h2',
      updated_at: 'z',
      revision: 6,
    })
    const wrapper = mountEditor(file())
    await flushPromises()

    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('# 新手册\n')
    await saveButton(wrapper)!.trigger('click')
    // 保存前 MUST 先讲明"无法恢复"（库中不留副本）
    expect(saveDialog(wrapper).attributes('open')).toBeDefined()
    expect(wrapper.text()).toContain('保存后无法恢复')

    await saveDialog(wrapper).find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(saveSkillFile).toHaveBeenCalledWith(
      'pdf-parse',
      'references/手册.md',
      '# 新手册\n',
      'h1',
    )
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ hash: 'h2' })
    expect(wrapper.text()).toContain('已保存')
    // 保存后不应再显示"未保存"
    expect(wrapper.text()).not.toContain('未保存')
  })

  it('保存前二次确认：取消则**不写入**，草稿保留（不可逆操作 MUST 由人确认）', async () => {
    const wrapper = mountEditor(file())
    await flushPromises()

    await wrapper.find('textarea').setValue('# 改过了\n')
    await saveButton(wrapper)!.trigger('click')
    expect(saveDialog(wrapper).attributes('open')).toBeDefined()

    await saveDialog(wrapper).find('[data-test="cancel"]').trigger('click')
    await flushPromises()

    expect(saveSkillFile).not.toHaveBeenCalled()
    expect(saveDialog(wrapper).attributes('open')).toBeUndefined()
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('# 改过了\n')
    expect(wrapper.text()).toContain('未保存')
  })

  it('未保存状态如实回传：改字为 true，放弃后回到 false', async () => {
    const wrapper = mountEditor(file())
    await flushPromises()
    expect(wrapper.emitted('update:dirty')?.at(-1)).toEqual([false])

    await wrapper.find('textarea').setValue('# 改过了\n')
    expect(wrapper.emitted('update:dirty')?.at(-1)).toEqual([true])
    expect(wrapper.text()).toContain('未保存')

    const discard = wrapper.findAll('button').find((button) => button.text() === '放弃修改')!
    await discard.trigger('click')
    expect(wrapper.emitted('update:dirty')?.at(-1)).toEqual([false])
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('# 手册\n')
  })

  it('未改动时保存按钮不可用（避免无意义的写入）', async () => {
    const wrapper = mountEditor(file())
    await flushPromises()
    expect(saveButton(wrapper)!.attributes('disabled')).toBeDefined()
  })

  it('二进制文件：不预览、不编辑，并说明替换方式', async () => {
    const wrapper = mountEditor(file({ binary: true, content: null, editable: false }))
    await flushPromises()

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text().startsWith('保存'))).toBe(false)
    expect(wrapper.text()).toContain('二进制文件')
    expect(wrapper.text()).toContain('ZIP 覆盖安装')
  })

  it('超限文件：只读展示并说明不提供编辑的原因', async () => {
    const wrapper = mountEditor(
      file({ truncated: true, editable: false, content: 'x', size: 999999 }),
    )
    await flushPromises()

    expect(wrapper.find('textarea').exists()).toBe(false)
    expect(wrapper.text()).toContain('不提供在线编辑')
    expect(wrapper.text()).toContain('256KB')
  })

  it('保存冲突（409）：提示可读原因并给出「重新加载最新内容」', async () => {
    saveSkillFile.mockRejectedValue({
      code: 'ADM_CONFIG_REVISION_CONFLICT',
      message: '文件已被他处修改（references/手册.md），本次保存未执行；请刷新后重新编辑',
    })
    const wrapper = mountEditor(file())
    await flushPromises()

    await wrapper.find('textarea').setValue('# 我的改动\n')
    await saveViaDialog(wrapper)

    expect(wrapper.text()).toContain('内容已被他处修改，请刷新后重试')
    expect(wrapper.text()).toContain('ADM_CONFIG_REVISION_CONFLICT')
    const reload = wrapper.findAll('button').find((button) => button.text() === '重新加载最新内容')!
    await reload.trigger('click')
    expect(wrapper.emitted('reload')).toBeTruthy()
  })

  it('加载中与空态都有明确提示', async () => {
    const loading = mount(SkillFileEditor, {
      props: { file: null, loading: true, error: null },
    })
    expect(loading.text()).toContain('加载中')

    const empty = mountEditor(null)
    expect(empty.text()).toContain('请从左侧选择一个文件')
  })
})
