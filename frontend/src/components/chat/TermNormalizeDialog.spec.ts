/**
 * 组件测试：术语替换确认弹窗（018）。
 *
 * 守五件事：
 * ① 两段文本与命中明细都呈现（用户能看清"改了什么"）；
 * ② 替换结果**可编辑**，主按钮派发的是编辑后的最终文本（首尾空白裁掉）；
 * ③ 编辑为空 / 纯空白 → 主按钮禁用 + 行内说明（`role="alert"` + `aria-invalid`），
 *    且点击不派发任何事件（MUST NOT 发出空消息）；
 * ④ Esc / 关闭 = **按原话继续**（不是取消发送）；
 * ⑤ 忙碌时按钮与编辑框都禁用（连点只发一次、发送中不改文本）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TermNormalizeDialog from './TermNormalizeDialog.vue'

const MATCH = { term: '供应商信息', value: '供应商或供应商编号', start: 3, end: 8 }
const NORMALIZED = '看下供应商或供应商编号的库存'

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(TermNormalizeDialog, {
    props: {
      open: true,
      original: '看下供应商信息的库存',
      normalized: NORMALIZED,
      matches: [MATCH],
      ...props,
    },
  })
}

function submitButton(wrapper: ReturnType<typeof mountDialog>) {
  return wrapper.findAll('button').find((item) => item.text().includes('使用替换后的表述'))!
}

describe('TermNormalizeDialog', () => {
  it('呈现原话、替换后与命中明细', () => {
    const wrapper = mountDialog()
    const text = wrapper.text()

    expect(text).toContain('确认术语替换')
    expect(text).toContain('看下供应商信息的库存')
    expect(text).toContain('供应商信息')
    expect(text).toContain('供应商或供应商编号')
  })

  it('替换结果以可编辑文本域呈现，初始值为模型给出的替换文', () => {
    const wrapper = mountDialog()
    const textarea = wrapper.find('textarea')

    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe(NORMALIZED)
    expect(textarea.attributes('disabled')).toBeUndefined()
  })

  it('未编辑时「使用替换后的表述」派发原替换文', async () => {
    const wrapper = mountDialog()
    await submitButton(wrapper).trigger('click')

    expect(wrapper.emitted('use-replacement')).toEqual([[NORMALIZED]])
  })

  it('手工修改后派发编辑后的文本（首尾空白裁掉）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('textarea').setValue('  看下钢材库存，按仓库分组  ')
    await submitButton(wrapper).trigger('click')

    expect(wrapper.emitted('use-replacement')).toEqual([['看下钢材库存，按仓库分组']])
  })

  it('清空后主按钮禁用并给出可读原因，点击不派发事件', async () => {
    const wrapper = mountDialog()
    await wrapper.find('textarea').setValue('')

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('不能为空')

    const button = submitButton(wrapper)
    expect(button.attributes('disabled')).toBeDefined()
    expect(button.attributes('title')).toContain('不能为空')

    const textarea = wrapper.find('textarea')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(textarea.attributes('aria-describedby')).toContain(alert.attributes('id'))

    await button.trigger('click')
    expect(wrapper.emitted('use-replacement')).toBeUndefined()
  })

  it('纯空白与清空同口径（不能只发空气）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('textarea').setValue('   \n  ')

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    expect(wrapper.find('[role="alert"]').text()).toContain('不能为空')

    await submitButton(wrapper).trigger('click')
    expect(wrapper.emitted('use-replacement')).toBeUndefined()
  })

  it('恢复为有效文本后按钮重新可用（校验是实时的）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('textarea').setValue('')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await wrapper.find('textarea').setValue('看下钢材库存')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)

    await submitButton(wrapper).trigger('click')
    expect(wrapper.emitted('use-replacement')).toEqual([['看下钢材库存']])
  })

  it('父级换了待确认内容时草稿重置（不把上一轮的编辑带进新一次替换）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('textarea').setValue('上一轮的编辑')

    await wrapper.setProps({ normalized: '新的替换文' })

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('新的替换文')
  })

  it('「按原话继续」派发 keep-original', async () => {
    const wrapper = mountDialog()
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('按原话继续'))!
      .trigger('click')
    expect(wrapper.emitted('keep-original')).toHaveLength(1)
  })

  it('Esc / 关闭 = 按原话继续（不取消整条消息）', async () => {
    const wrapper = mountDialog()
    await wrapper.find('dialog').trigger('cancel')
    expect(wrapper.emitted('keep-original')).toHaveLength(1)
    expect(wrapper.emitted('use-replacement')).toBeUndefined()
  })

  it('发送中按钮与编辑框都禁用（连点只发一次、发送中不改文本）', () => {
    const wrapper = mountDialog({ busy: true })
    const buttons = wrapper
      .findAll('button')
      .filter((item) => item.text().includes('替换') || item.text().includes('原话'))
    expect(buttons).toHaveLength(2)
    for (const button of buttons) expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  })
})
