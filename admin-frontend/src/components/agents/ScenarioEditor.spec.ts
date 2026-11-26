import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ScenarioField } from '../../api/types'
import ScenarioEditor from './ScenarioEditor.vue'

function mountEditor(
  scenario = '',
  dirs: string[] = [],
  fields: Record<string, ScenarioField[]> = {},
  uploads?: Record<string, string[]>,
) {
  const modelValue: Record<string, unknown> = {
    scenario,
    data_prep_dirs: dirs,
    data_prep_fields: fields,
  }
  if (uploads) modelValue.data_prep_uploads = uploads
  return mount(ScenarioEditor, { props: { modelValue: modelValue as never } })
}

describe('ScenarioEditor', () => {
  it('场景名为空时给出必填提示', () => {
    const wrapper = mountEditor('')
    expect(wrapper.text()).toContain('场景名必填')
    expect(wrapper.find('input[aria-invalid="true"]').exists()).toBe(true)
  })

  it('场景名含分隔符或 ".." 时给出可读提示', () => {
    expect(mountEditor('a/b').text()).toContain('不得含路径分隔符')
    expect(mountEditor('a..b').text()).toContain('不得含路径分隔符')
  })

  it('合法场景名不报错', () => {
    const wrapper = mountEditor('生产计划')
    expect(wrapper.text()).not.toContain('场景名必填')
    expect(wrapper.find('input[aria-invalid="true"]').exists()).toBe(false)
  })

  it('修改场景名发出 update:modelValue（原样，不 trim）', async () => {
    const wrapper = mountEditor('旧名')
    await wrapper.find('#scenario-name').setValue('新名 ')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '新名 ',
      data_prep_dirs: [],
      data_prep_fields: {},
    })
  })

  it('添加二级目录：回车或点击按钮均生效', async () => {
    const wrapper = mountEditor('生产', ['生产计划'])
    await wrapper.find('#scenario-new-dir').setValue('产线电价')
    await wrapper.find('#scenario-new-dir').trigger('keydown.enter')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '产线电价'],
      data_prep_fields: {},
    })
  })

  it('重复目录不被追加（避免产生重复值）', async () => {
    const wrapper = mountEditor('生产', ['生产计划'])
    await wrapper.find('#scenario-new-dir').setValue('生产计划')
    await wrapper.find('#scenario-new-dir').trigger('keydown.enter')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('空目录名不追加', async () => {
    const wrapper = mountEditor('生产', [])
    await wrapper.find('#scenario-new-dir').setValue('   ')
    const addBtn = wrapper.findAll('button').find((b) => b.text() === '添加目录')
    await addBtn?.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('移除目录', async () => {
    const wrapper = mountEditor('生产', ['生产计划', '产线电价'])
    const remove = wrapper.findAll('button').find((b) => b.text() === '移除')
    await remove?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['产线电价'],
      data_prep_fields: {},
      data_prep_uploads: {},
    })
  })

  it('重复目录被显式标注（异常提示可见）', () => {
    const wrapper = mountEditor('生产', ['生产计划', '生产计划'])
    expect(wrapper.text()).toContain('存在重复目录名')
  })

  it('边界：空清单是**合法**状态（全部屏蔽），不再提示"会被后端拒绝"', () => {
    const wrapper = mountEditor('生产', [])
    expect(wrapper.text()).toContain('不会显示任何二级目录')
    expect(wrapper.text()).toContain('已上传的文件仍保留')
    expect(wrapper.text()).not.toContain('会被后端拒绝')
  })

  it('预定义目录「算法规则」显示标识且不可**移除**（只有「屏蔽」）', () => {
    const wrapper = mountEditor('生产', ['算法规则', '生产计划'])
    expect(wrapper.find('[data-test="predefined-badge"]').exists()).toBe(true)
    expect(wrapper.findAll('button').filter((b) => b.text() === '移除').length).toBe(1)
    expect(wrapper.find('[data-test="block-算法规则"]').exists()).toBe(true)
  })

  it('仅预定义目录在清单中时，无「移除」按钮（防御式拦截 removeDir）', async () => {
    const wrapper = mountEditor('生产', ['算法规则'])
    expect(wrapper.findAll('button').filter((b) => b.text() === '移除').length).toBe(0)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('屏蔽预定义目录：从清单移除，并**清掉**它的字段约束与可上传类型', async () => {
    const wrapper = mountEditor(
      '生产',
      ['算法规则', '生产计划'],
      { 算法规则: [{ name: '优先级', type: 'integer', required: false }] },
      { 算法规则: ['.csv'] },
    )

    await wrapper.find('[data-test="block-算法规则"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划'],
      data_prep_fields: {},
      data_prep_uploads: {},
    })
  })

  it('已屏蔽的预定义目录单独成区，带「已屏蔽」标识与「启用」入口', () => {
    const wrapper = mountEditor('生产', ['生产计划'])

    expect(wrapper.find('[data-test="blocked-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('已屏蔽的预定义目录')
    expect(wrapper.find('[data-test="enable-算法规则"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="block-算法规则"]').exists()).toBe(false)
  })

  it('启用（恢复）预定义目录：追加到清单末尾', async () => {
    const wrapper = mountEditor('生产', ['生产计划'])

    await wrapper.find('[data-test="enable-算法规则"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '算法规则'],
      data_prep_fields: {},
    })
  })

  it('全部屏蔽（清单为空）时仍可启用', async () => {
    const wrapper = mountEditor('生产', [])

    await wrapper.find('[data-test="enable-算法规则"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['算法规则'],
      data_prep_fields: {},
    })
  })

  it('预定义目录仍可配置字段，且 0 条字段 = 无约束（不强制字段）', async () => {
    const wrapper = mountEditor('生产', ['算法规则'])
    await wrapper.find('[data-test="field-算法规则"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="save"]').trigger('click')

    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as {
      data_prep_fields: Record<string, unknown>
    }
    expect(emitted.data_prep_fields).toEqual({})
  })

  it('新增目录后**立即弹出**字段约束窗口（标题含目录名）', async () => {
    const wrapper = mountEditor('生产', [])
    await wrapper.find('#scenario-new-dir').setValue('产线电价')
    await wrapper.find('#scenario-new-dir').trigger('keydown.enter')
    await wrapper.vm.$nextTick()

    const dialog = wrapper.find('[data-test="scenario-field-dialog"]')
    expect(dialog.attributes('open')).toBeDefined()
    expect(dialog.text()).toContain('产线电价')
    expect(wrapper.find('[data-test="no-fields"]').exists()).toBe(true)
  })

  it('窗口内添加字段并保存：按目录写入 data_prep_fields', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="field-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('#scenario-field-name-0').setValue('产线编号')
    await wrapper.find('#scenario-field-type-0').setValue('integer')
    await wrapper.find('[data-test="save"]').trigger('click')

    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as {
      data_prep_fields: Record<string, unknown>
    }
    expect(emitted.data_prep_fields).toEqual({
      产线电价: [{ name: '产线编号', type: 'integer', required: true }],
    })
  })

  it('空字段列表点保存 ⇒ 不产生该目录的键（等价"暂不设置"）', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="field-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="save"]').trigger('click')

    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as {
      data_prep_fields: Record<string, unknown>
    }
    expect(emitted.data_prep_fields).toEqual({})
  })

  it('字段名非法 / 重复时禁用保存（后端仍是权威判定）', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="field-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('#scenario-field-name-0').setValue('a/b')

    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()

    await wrapper.find('#scenario-field-name-0').setValue('产线编号')
    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('#scenario-field-name-1').setValue('产线编号')
    expect(wrapper.text()).toContain('字段名重复')
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()
  })

  it('取消不改动任何配置（新增的目录仍在清单里）', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="field-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="cancel"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find('[data-test="scenario-field-dialog"]').attributes('open')).toBeUndefined()
  })

  it('目录行显示字段数，且已有约束打开时可回显', async () => {
    const wrapper = mountEditor('生产', ['产线电价'], {
      产线电价: [{ name: '产线编号', type: 'string', required: true }],
    })
    expect(wrapper.text()).toContain('字段(1)')

    await wrapper.find('[data-test="field-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('#scenario-field-name-0').element as HTMLInputElement
    expect(input.value).toBe('产线编号')
  })

  it('移除目录时**同时移除**其字段约束（不留孤儿配置，且不动文件）', async () => {
    const wrapper = mountEditor('生产', ['生产计划', '产线电价'], {
      生产计划: [{ name: '产线编号', type: 'string', required: true }],
    })
    const remove = wrapper.findAll('button').find((b) => b.text() === '移除')
    await remove?.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['产线电价'],
      data_prep_fields: {},
      data_prep_uploads: {},
    })
  })

  it('每个目录行在「字段」之后出现「文件类型」入口，数量等于目录数', () => {
    const wrapper = mountEditor('生产', ['算法规则', '生产计划'])
    const rows = wrapper.findAll('.scenario-editor__list li')
    expect(rows).toHaveLength(2)

    expect(rows[1].findAll('button').map((b) => b.text())).toEqual([
      '字段(0)',
      '文件类型(2)',
      '移除',
    ])
    // 预定义目录：同两个入口 + 「屏蔽」（不可删除，只能屏蔽）
    expect(rows[0].findAll('button').map((b) => b.text())).toEqual([
      '字段(0)',
      '文件类型(2)',
      '屏蔽',
    ])
    expect(wrapper.findAll('[data-test^="upload-types-"]')).toHaveLength(2)
  })

  it('未配置目录显示默认项数 2，已配置目录显示实际项数', () => {
    const wrapper = mountEditor(
      '生产',
      ['生产计划', '产线电价'],
      {},
      { 产线电价: ['.csv', '.xlsx', '.txt'] },
    )
    expect(wrapper.text()).toContain('文件类型(3)')
    expect(wrapper.text()).toContain('文件类型(2)')
  })

  it('打开窗口默认勾选 .csv/.xlsx，保存后按目录写入 data_prep_uploads', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="upload-types-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-test="upload-ext-.txt"]').setValue(true)
    const dialog = '[data-test="scenario-upload-types-dialog"]'
    await wrapper.find(`${dialog} [data-test="save"]`).trigger('click')

    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as {
      data_prep_uploads: Record<string, string[]>
    }
    expect(emitted.data_prep_uploads).toEqual({ 产线电价: ['.xlsx', '.csv', '.txt'] })
  })

  it('已配置目录打开窗口时回显其配置（非默认）', async () => {
    const wrapper = mountEditor('生产', ['产线电价'], {}, { 产线电价: ['.json'] })
    await wrapper.find('[data-test="upload-types-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()

    const json = wrapper.find('[data-test="upload-ext-.json"]').element as HTMLInputElement
    const csv = wrapper.find('[data-test="upload-ext-.csv"]').element as HTMLInputElement
    expect(json.checked).toBe(true)
    expect(csv.checked).toBe(false)
  })

  it('取消不改动配置（不发 update:modelValue）', async () => {
    const wrapper = mountEditor('生产', ['产线电价'])
    await wrapper.find('[data-test="upload-types-产线电价"]').trigger('click')
    await wrapper.vm.$nextTick()
    const dialog = '[data-test="scenario-upload-types-dialog"]'
    await wrapper.find(`${dialog} [data-test="cancel"]`).trigger('click')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.find(dialog).attributes('open')).toBeUndefined()
  })

  it('移除目录时**同时移除**其可上传类型配置（不留孤儿键）', async () => {
    const wrapper = mountEditor(
      '生产',
      ['生产计划', '产线电价'],
      {},
      {
        生产计划: ['.csv', '.xlsx'],
        产线电价: ['.json'],
      },
    )
    const remove = wrapper.findAll('button').find((b) => b.text() === '移除')
    await remove?.trigger('click')

    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0] as {
      data_prep_uploads: Record<string, string[]>
    }
    expect(emitted.data_prep_uploads).toEqual({ 产线电价: ['.json'] })
  })
})
