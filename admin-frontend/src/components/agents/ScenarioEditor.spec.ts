/**
 * 组件测试：文件空间场景编辑器（T059）
 *
 * 覆盖 `FR-020` 的校验口径：场景名非空、目录清单拒绝空值 / 重复 /
 * 含分隔符 / `..`；以及"收缩清单不删除文件"的口径提示。
 *
 * 以及二级目录的**字段约束**（`data_prep_fields`）：新增目录即弹出确认窗口、
 * 空清单 = 无约束（等价"暂不设置"）、移除目录同时移除其约束。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ScenarioField } from '../../api/types'
import ScenarioEditor from './ScenarioEditor.vue'

function mountEditor(
  scenario = '',
  dirs: string[] = [],
  fields: Record<string, ScenarioField[]> = {},
) {
  return mount(ScenarioEditor, {
    props: { modelValue: { scenario, data_prep_dirs: dirs, data_prep_fields: fields } },
  })
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
    })
  })

  it('重复目录被显式标注（异常提示可见）', () => {
    const wrapper = mountEditor('生产', ['生产计划', '生产计划'])
    expect(wrapper.text()).toContain('存在重复目录名')
  })

  it('边界：空清单合法，且提示"收缩清单不会删除已有文件"', () => {
    const wrapper = mountEditor('生产', [])
    expect(wrapper.text()).toContain('未配置二级目录')
    expect(wrapper.text()).toContain('不会删除已有文件')
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
    })
  })
})
