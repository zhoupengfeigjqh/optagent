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
import { SOUL_LIMITS, emptySoulDesign } from '../../constants/agent-design'
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

/**
 * 007：下一步动作提示开关。
 *
 * 守三件事：**文案与默认值**（管理员看到的正是"关闭"）、**勾选即上抛布尔**（不是字符串）、
 * 以及**开关的产物去向**在界面上说清（部署后写进 SOUL.md，而不是影响模型行为）。
 */
describe('SoulEditor —— 下一步动作提示开关（007）', () => {
  function checkbox(wrapper: ReturnType<typeof mountEditor>) {
    return wrapper.find<HTMLInputElement>('[data-test="next-action-hints"]')
  }

  it('渲染为原生 checkbox，文案为「是否开启下一步动作提示」，默认关闭', () => {
    const wrapper = mountEditor()

    const input = checkbox(wrapper)
    expect(input.exists()).toBe(true)
    expect(input.element.type).toBe('checkbox')
    expect(input.element.checked).toBe(false)
    expect(wrapper.find('.soul-editor__next-steps').text()).toContain('是否开启下一步动作提示')
  })

  it('勾选 → `update:modelValue` 携带 `next_action_hints: true`（布尔，不是字符串）', async () => {
    const wrapper = mountEditor()
    const input = checkbox(wrapper)

    await input.setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints).toBe(true)
    // 其余字段原样带出（patch 是整体替换）
    expect(emitted.mission).toBe('')
  })

  it('已开启的设计态回显为勾选；取消勾选回传 `false`', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), next_action_hints: true })
    const input = checkbox(wrapper)
    expect(input.element.checked).toBe(true)

    await input.setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints).toBe(false)
  })

  it('界面说明开关的去向与关闭后果（不影响模型行为、关闭即产物无该键）', () => {
    const wrapper = mountEditor()
    const hint = wrapper.find('[data-test="next-action-hints-hint"]').text()

    expect(hint).toContain('可点击的下一步动作卡片')
    expect(hint).toContain('产物里不会写这个键')
    // 文案里的条数与输入框当前值同源（管理员看到的提示不会与实际参数脱节）
    expect(hint).toContain(`最多 ${emptySoulDesign().next_action_hints_count} 条`)
  })

  it('存量设计态缺该键（004 期存档）→ 按关闭渲染，不报错', () => {
    const legacy = { ...emptySoulDesign() } as Partial<SoulDesign>
    delete legacy.next_action_hints

    const wrapper = mountEditor(legacy as SoulDesign)

    expect(checkbox(wrapper).element.checked).toBe(false)
  })

  /**
   * 007：开关的**参数**（每轮最多几条提示）。
   *
   * 守三件事：约束（`min` / `max` / 缺省与 `SOUL_LIMITS` 同源）、**关闭时置灰但数值保留**、
   * 以及**拒绝式**——非法值不上抛、输入框弹回当前值（避免"界面显示 7、产物写 3"）。
   */
  function countInput(wrapper: ReturnType<typeof mountEditor>) {
    return wrapper.find<HTMLInputElement>('[data-test="next-action-hints-count"]')
  }

  /** 数字输入框的 `change`（不是 `input`）：输入中不打断，离开或用回车才提交 */
  async function setCount(wrapper: ReturnType<typeof mountEditor>, value: string) {
    const input = countInput(wrapper)
    input.element.value = value
    await input.trigger('change')
    return input
  }

  it('条数输入：渲染为 number，min / max 与常量一致，关闭时置灰且显示缺省值', () => {
    const wrapper = mountEditor()
    const input = countInput(wrapper)

    expect(input.exists()).toBe(true)
    expect(input.element.type).toBe('number')
    expect(input.attributes('min')).toBe(String(SOUL_LIMITS.nextActionHintsMin))
    expect(input.attributes('max')).toBe(String(SOUL_LIMITS.nextActionHintsMax))
    expect(input.element.value).toBe(String(SOUL_LIMITS.nextActionHintsDefault))
    // 未开启 → 灰态：`disabled` 挡住输入，`--off` 类负责视觉弱化
    expect(input.element.disabled).toBe(true)
    expect(wrapper.find('.soul-editor__count').classes()).toContain('soul-editor__count--off')
  })

  it('取消勾选开关 → 条数输入变灰且不能填；重新勾选即恢复', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), next_action_hints: true })

    expect(countInput(wrapper).element.disabled).toBe(false)
    expect(wrapper.find('.soul-editor__count').classes()).not.toContain('soul-editor__count--off')

    // 受控组件：勾选只上抛，灰态由父级回填的 `modelValue` 决定
    await wrapper.setProps({ modelValue: { ...emptySoulDesign(), next_action_hints: false } })
    expect(countInput(wrapper).element.disabled).toBe(true)
    expect(wrapper.find('.soul-editor__count').classes()).toContain('soul-editor__count--off')

    await wrapper.setProps({ modelValue: { ...emptySoulDesign(), next_action_hints: true } })
    expect(countInput(wrapper).element.disabled).toBe(false)
  })

  it('开启开关：输入可用；关闭时填的数值被保留回显（不必重填）', () => {
    const off = mountEditor({ ...emptySoulDesign(), next_action_hints: false, next_action_hints_count: 5 })
    expect(countInput(off).element.disabled).toBe(true)
    expect(countInput(off).element.value).toBe('5')

    const on = mountEditor({ ...emptySoulDesign(), next_action_hints: true })
    expect(countInput(on).element.disabled).toBe(false)
  })

  it('改条数为 1~6 的整数 → `update:modelValue` 携带新数值（其余字段原样带出）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), next_action_hints: true })

    await setCount(wrapper, '6')

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints_count).toBe(6)
    expect(emitted.next_action_hints).toBe(true)
    expect(emitted.mission).toBe('')
  })

  it('条数与当前值相同 → 不产生改动（不制造无谓的 dirty）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), next_action_hints: true })

    await setCount(wrapper, '3')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('越界 / 小数 / 空 → 拒绝式：不上抛，输入框弹回当前值', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), next_action_hints: true, next_action_hints_count: 5 })

    for (const bad of ['7', '0', '2.5', '', 'abc']) {
      const input = await setCount(wrapper, bad)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(input.element.value).toBe('5')
    }
  })
})
