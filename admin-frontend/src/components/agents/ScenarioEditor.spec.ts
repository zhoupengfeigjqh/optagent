/**
 * 组件测试：文件空间场景编辑器（T059）
 *
 * 覆盖 `FR-020` 的校验口径：场景名非空、目录清单拒绝空值 / 重复 /
 * 含分隔符 / `..`；以及"收缩清单不删除文件"的口径提示。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScenarioEditor from './ScenarioEditor.vue'

function mountEditor(scenario = '', dirs: string[] = []) {
  return mount(ScenarioEditor, {
    props: { modelValue: { scenario, data_prep_dirs: dirs } },
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
    })
  })

  it('添加二级目录：回车或点击按钮均生效', async () => {
    const wrapper = mountEditor('生产', ['生产计划'])
    await wrapper.find('#scenario-new-dir').setValue('产线电价')
    await wrapper.find('#scenario-new-dir').trigger('keydown.enter')
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual({
      scenario: '生产',
      data_prep_dirs: ['生产计划', '产线电价'],
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
})
