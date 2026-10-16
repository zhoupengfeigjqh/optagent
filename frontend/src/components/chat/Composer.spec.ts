/**
 * 组件测试：输入区（`@` 面板的数据与锚点出口、引用芯片展示）。
 *
 * 守住的语义：`mention` 插槽只向外提供**数据与锚点**——面板本体是 `fixed` 浮层
 * （见 MentionPopup），不再参与流内排版；而选完文件后的**引用芯片展示保持不变**
 * （浮层改造不得改变"选完之后长什么样"）。
 */
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { FileReference } from '../../api/types'
import Composer from './Composer.vue'

const REFERENCE: FileReference = { dir: '数据准备/生产计划', filename: '产能.xlsx' }

function mountComposer(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(Composer, { props: { modelValue: '', ...props }, slots })
}

describe('Composer —— 引用芯片', () => {
  it('已选引用以「@文件名 + 移除按钮」呈现', () => {
    const wrapper = mountComposer({ references: [REFERENCE] })

    const chips = wrapper.findAll('.composer__ref')
    expect(chips).toHaveLength(1)
    expect(chips[0]!.find('.composer__ref-text').text()).toBe('@产能.xlsx')
    expect(chips[0]!.find('.composer__ref-remove').attributes('aria-label')).toBe(
      '移除引用 产能.xlsx',
    )
  })

  it('点击移除按钮上报引用（是否真的移除由上层决定）', async () => {
    const wrapper = mountComposer({ references: [REFERENCE] })

    await wrapper.find('.composer__ref-remove').trigger('click')

    expect(wrapper.emitted('remove-reference')).toEqual([[REFERENCE]])
  })

  it('没有引用时不渲染芯片列表', () => {
    expect(mountComposer().find('.composer__refs').exists()).toBe(false)
  })
})

describe('Composer —— 输入提示', () => {
  it('占位文案提示可打 `@` 引用文件；键盘提示常驻在输入框下方（原型同款）', () => {
    const wrapper = mountComposer()

    expect(wrapper.find('textarea.composer__input').attributes('placeholder')).toBe(
      '输入消息：打 @ 可引用文件空间里的文件',
    )
    expect(wrapper.find('.composer__hint').text()).toBe('Enter 发送 · Shift + Enter 换行')
  })
})

describe('Composer —— mention 插槽', () => {
  it('向外提供输入框锚点（面板据此紧贴光标定位）', async () => {
    const wrapper = mountComposer(
      {},
      { mention: '<div class="probe">{{ anchor ? anchor.tagName : "none" }}</div>' },
    )
    await nextTick() // 模板 ref 在挂载后才落到插槽

    expect(wrapper.find('.probe').text()).toBe('TEXTAREA')
    expect(wrapper.find('textarea.composer__input').exists()).toBe(true)
  })

  it('面板展开时方向键被拦截并上抛（面板本体不在输入框内）', async () => {
    const wrapper = mountComposer({ mentionOpen: true })

    await wrapper.find('textarea.composer__input').trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.emitted('mention-key')).toEqual([['ArrowDown']])
  })

  it('面板未展开时不上抛按键（输入框照常移动光标）', async () => {
    const wrapper = mountComposer()

    await wrapper.find('textarea.composer__input').trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.emitted('mention-key')).toBeUndefined()
  })
})
