/**
 * 组件测试：数据准备目录的字段约束窗口。
 *
 * 覆盖口径：六种取值类型可选；空列表 = 该目录不设约束（等价"暂不设置"）；
 * 字段名非法 / 重复时禁用保存；取消与 Esc 不改动配置。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScenarioFieldDialog from './ScenarioFieldDialog.vue'

function mountDialog(fields: Array<{ name: string; type: string; required: boolean }> = []) {
  return mount(ScenarioFieldDialog, {
    props: { open: true, dir: '产线电价', fields: fields as never },
  })
}

describe('ScenarioFieldDialog', () => {
  it('标题含目标目录名，并说明列表为空即不设约束', () => {
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('产线电价')
    expect(wrapper.find('[data-test="no-fields"]').text()).toContain('不设字段约束')
  })

  it('取值类型提供契约的六种枚举', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    const values = wrapper.findAll('option').map((o) => o.attributes('value'))
    expect(values).toEqual(['string', 'integer', 'number', 'boolean', 'object', 'array'])
  })

  it('添加字段默认必填，可移除', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    const checkbox = wrapper.find('input[type="checkbox"]').element as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    await wrapper.findAll('button').find((b) => b.text() === '移除')?.trigger('click')
    expect(wrapper.find('[data-test="no-fields"]').exists()).toBe(true)
  })

  it('保存发出字段清单并关闭', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('#scenario-field-name-0').setValue('计划量')
    await wrapper.find('#scenario-field-type-0').setValue('integer')
    await wrapper.find('[data-test="save"]').trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual([
      { name: '计划量', type: 'integer', required: true },
    ])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('字段名为空 / 含分隔符 / 重复时禁用保存并给出原因', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()

    await wrapper.find('#scenario-field-name-0').setValue('a..b')
    expect(wrapper.text()).toContain('不得含路径分隔符')

    await wrapper.find('#scenario-field-name-0').setValue('产线编号')
    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('#scenario-field-name-1').setValue('产线编号')
    expect(wrapper.text()).toContain('字段名重复')
  })

  it('取消与 Esc：不发 save、只关窗（不改动配置）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-test="add-field"]').trigger('click')
    await wrapper.find('[data-test="cancel"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])

    const escWrapper = mountDialog()
    const event = new Event('cancel', { cancelable: true })
    await escWrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(escWrapper.emitted('save')).toBeUndefined()
  })

  it('打开时回显传入的已有字段（副本，不直接改 props）', async () => {
    const wrapper = mountDialog([{ name: '产线编号', type: 'string', required: true }])
    const input = wrapper.find('#scenario-field-name-0').element as HTMLInputElement
    expect(input.value).toBe('产线编号')

    await wrapper.find('#scenario-field-name-0').setValue('改后')
    expect(wrapper.props('fields')[0].name).toBe('产线编号')
  })
})
