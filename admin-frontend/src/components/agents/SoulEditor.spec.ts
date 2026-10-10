/**
 * 组件测试：SOUL 编辑器（`FR-016`、`FR-019`）。
 *
 * 这里守的是**必填项的可辨识性**：角色简介、主要使命、以及「快速上手」入口
 * （其内部「首屏欢迎语」必填）都 MUST 在界面上标出必填星号——三者对应后端
 * `soul-design.ts` 的 `readRequiredText` 必填字段，界面漏标会让管理员
 * 只在"保存被拒"时才发现（原则四）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SoulEditor from './SoulEditor.vue'
import { emptySoulDesign } from '../../constants/agent-design'
import type { SoulDesign } from '../../api/types'

function mountEditor(modelValue: SoulDesign = emptySoulDesign()) {
  return mount(SoulEditor, {
    props: {
      modelValue,
      enabledTools: [],
      builtinTools: [],
      mountedServices: [],
      mcpServices: [],
    },
  })
}

describe('SoulEditor —— 必填项标识', () => {
  it('角色简介与主要使命的标签标注必填', () => {
    const wrapper = mountEditor()
    expect(wrapper.find('label[for="soul-intro"] .field__required').exists()).toBe(true)
    expect(wrapper.find('label[for="soul-mission"] .field__required').exists()).toBe(true)
  })

  it('「快速上手」入口标注必填（其内部「首屏欢迎语」为必填项）', () => {
    const wrapper = mountEditor()
    const legend = wrapper.find('.soul-editor__quick-start legend')

    expect(legend.text()).toContain('快速上手')
    expect(legend.find('.field__required').exists()).toBe(true)
  })

  it('点「编辑快速上手」打开弹窗', async () => {
    const wrapper = mountEditor()
    await wrapper.find('[data-test="open-quick-start"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="quick-start-dialog"]').attributes('open')).toBeDefined()
  })
})
