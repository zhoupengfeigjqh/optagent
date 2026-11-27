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
    const block = wrapper.find('.soul-editor__intent-focus')
    expect(block.text()).toContain('是否开启下一步动作提示')
    expect(block.text()).toContain('输入重写')
    expect(block.text()).toContain('术语替换')
  })

  it('勾选 → `update:modelValue` 携带 `next_action_hints: true`（布尔，不是字符串）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    const input = checkbox(wrapper)

    await input.setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints).toBe(true)
    expect(emitted.mission).toBe('')
  })

  it('已开启的设计态回显为勾选；取消勾选回传 `false`', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })
    const input = checkbox(wrapper)
    expect(input.element.checked).toBe(true)

    await input.setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints).toBe(false)
  })

  it('界面说明开关的去向与关闭后果（依赖可见、关闭即置灰）', () => {
    const wrapper = mountEditor()

    const groupHint = wrapper.find('[data-test="intent-focus-group-hint"]').text()
    expect(groupHint).toContain('都以「开启意图聚焦」为前提')
    expect(groupHint).toContain('下一步动作提示则会被一并关闭')

    const countHint =
      wrapper.find('[data-test="next-action-hints-count"]').element.closest('label')?.textContent ?? ''
    expect(countHint).toContain(`缺省 ${emptySoulDesign().next_action_hints_count} 条`)

    // 关闭后果：意图聚焦默认关闭 → 条数输入框置灰不可填
    expect(wrapper.find<HTMLInputElement>('[data-test="next-action-hints-count"]').element.disabled).toBe(
      true,
    )
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
    expect(input.element.disabled).toBe(true)
    expect(wrapper.find('.soul-editor__count').classes()).toContain('soul-editor__count--off')
  })

  it('取消勾选开关 → 条数输入变灰且不能填；重新勾选即恢复', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })

    expect(countInput(wrapper).element.disabled).toBe(false)
    expect(wrapper.find('.soul-editor__count').classes()).not.toContain('soul-editor__count--off')

    await wrapper.setProps({ modelValue: { ...emptySoulDesign(), next_action_hints: false } })
    expect(countInput(wrapper).element.disabled).toBe(true)
    expect(wrapper.find('.soul-editor__count').classes()).toContain('soul-editor__count--off')

    await wrapper.setProps({ modelValue: { ...emptySoulDesign(), intent_focus: true, next_action_hints: true } })
    expect(countInput(wrapper).element.disabled).toBe(false)
  })

  it('开启开关：输入可用；关闭时填的数值被保留回显（不必重填）', () => {
    const off = mountEditor({
      ...emptySoulDesign(),
      next_action_hints: false,
      next_action_hints_count: 5,
    })
    expect(countInput(off).element.disabled).toBe(true)
    expect(countInput(off).element.value).toBe('5')

    const on = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })
    expect(countInput(on).element.disabled).toBe(false)
  })

  it('改条数为 1~6 的整数 → `update:modelValue` 携带新数值（其余字段原样带出）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })

    await setCount(wrapper, '6')

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints_count).toBe(6)
    expect(emitted.next_action_hints).toBe(true)
    expect(emitted.mission).toBe('')
  })

  it('条数与当前值相同 → 不产生改动（不制造无谓的 dirty）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })

    await setCount(wrapper, '3')

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('越界 / 小数 / 空 → 拒绝式：不上抛，输入框弹回当前值', async () => {
    const wrapper = mountEditor({
      ...emptySoulDesign(),
      intent_focus: true,
      next_action_hints: true,
      next_action_hints_count: 5,
    })

    for (const bad of ['7', '0', '2.5', '', 'abc']) {
      const input = await setCount(wrapper, bad)
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
      expect(input.element.value).toBe('5')
    }
  })
})

describe('SoulEditor —— 意图聚焦开关（013）', () => {
  function checkbox(wrapper: ReturnType<typeof mountEditor>) {
    return wrapper.find<HTMLInputElement>('[data-test="intent-focus"]')
  }

  it('渲染为原生 checkbox，文案为「是否开启意图聚焦」，默认关闭', () => {
    const wrapper = mountEditor()
    const input = checkbox(wrapper)

    expect(input.exists()).toBe(true)
    expect(input.element.type).toBe('checkbox')
    expect(input.element.checked).toBe(false)
    expect(wrapper.find('.soul-editor__intent-focus').text()).toContain('是否开启意图聚焦')
  })

  it('勾选 → `update:modelValue` 携带 `intent_focus: true`（布尔，不是字符串）', async () => {
    const wrapper = mountEditor()

    await checkbox(wrapper).setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(true)
    expect(emitted.next_action_hints).toBe(false)
    expect(emitted.mission).toBe('')
  })

  it('已开启的设计态回显为勾选；取消勾选回传 `false`', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    const input = checkbox(wrapper)
    expect(input.element.checked).toBe(true)

    await input.setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(false)
  })

  it('开启意图聚焦不会顺带打开下一步动作提示（仍须手动开启）', async () => {
    const wrapper = mountEditor()

    await checkbox(wrapper).setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.next_action_hints).toBe(false)
    expect(emitted.intent_focus).toBe(true)
    expect(checkbox(wrapper).element.checked).toBe(true)
    expect(wrapper.find<HTMLInputElement>('[data-test="next-action-hints"]').element.checked).toBe(
      false,
    )
  })

  it('关闭意图聚焦会顺带关闭下一步动作提示（依赖关系，不是互相独立）', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, next_action_hints: true })

    await checkbox(wrapper).setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(false)
    expect(emitted.next_action_hints).toBe(false)
  })

  it('意图聚焦关闭时下一步动作提示复选框置灰；开启时可用', () => {
    const off = mountEditor()
    expect(off.find<HTMLInputElement>('[data-test="next-action-hints"]').element.disabled).toBe(true)

    const on = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    expect(on.find<HTMLInputElement>('[data-test="next-action-hints"]').element.disabled).toBe(false)
  })

  it('界面说明开关的去向与关闭后果（关闭即产物无该键、预置卡片轮次跳过）', () => {
    const wrapper = mountEditor()
    const hint = wrapper.find('[data-test="intent-focus-hint"]').text()

    expect(hint).toContain('意图判定')
    expect(hint).toContain('有本体技能时阶数配置才生效')
  })

  it('存量设计态缺该键 → 按关闭渲染，不报错', () => {
    const legacy = { ...emptySoulDesign() } as Partial<SoulDesign>
    delete legacy.intent_focus

    const wrapper = mountEditor(legacy as SoulDesign)

    expect(checkbox(wrapper).element.checked).toBe(false)
  })
})

describe('SoulEditor —— 聚焦阶数（019）', () => {
  function radio(wrapper: ReturnType<typeof mountEditor>, depth: number) {
    return wrapper.find<HTMLInputElement>(`[data-test="intent-focus-depth-${depth}"]`)
  }

  it('渲染 0 / 1 / 2 三个单选，默认选中 0', () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })

    for (const depth of [0, 1, 2]) {
      expect(radio(wrapper, depth).exists()).toBe(true)
      expect(radio(wrapper, depth).element.type).toBe('radio')
    }
    expect(radio(wrapper, 0).element.checked).toBe(true)
    expect(radio(wrapper, 2).element.checked).toBe(false)
  })

  it('选中 2 → `update:modelValue` 携带数字 2', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })

    await radio(wrapper, 2).setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus_depth).toBe(2)
    expect(emitted.intent_focus).toBe(true)
    expect(emitted.mission).toBe('')
  })

  it('意图聚焦关闭时整组置灰；开启时可用', () => {
    const off = mountEditor()
    for (const depth of [0, 1, 2]) expect(radio(off, depth).element.disabled).toBe(true)

    const on = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    for (const depth of [0, 1, 2]) expect(radio(on, depth).element.disabled).toBe(false)
  })

  it('关闭状态下数值保留：仍回显选中项（再次打开即恢复）', () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: false, intent_focus_depth: 2 })
    expect(radio(wrapper, 2).element.checked).toBe(true)
  })

  it('关闭意图聚焦只改开关，不动已选阶数', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, intent_focus_depth: 1 })

    await wrapper.find<HTMLInputElement>('[data-test="intent-focus"]').setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(false)
    expect(emitted.intent_focus_depth).toBe(1)
  })

  it('界面说明上下游去向（上游进提示、下游进动作提示）', () => {
    const hint = mountEditor().find('[data-test="intent-focus-depth-hint"]').text()
    expect(hint).toContain('上游')
    expect(hint).toContain('下游')
    expect(hint).toContain('缺省 0 阶')
  })
})

describe('SoulEditor —— 输入重写 / 术语替换开关（027）', () => {
  function checkbox(wrapper: ReturnType<typeof mountEditor>, key: string) {
    return wrapper.find<HTMLInputElement>(`[data-test="${key}"]`)
  }

  it('缺省两个开关都不勾选（新建数字人不多花模型调用）', () => {
    const wrapper = mountEditor()

    expect(checkbox(wrapper, 'input-rewrite').element.checked).toBe(false)
    expect(checkbox(wrapper, 'term-normalize').element.checked).toBe(false)
  })

  it('意图聚焦关闭时置灰；开启时可用', () => {
    const off = mountEditor()
    expect(checkbox(off, 'input-rewrite').element.disabled).toBe(true)
    expect(checkbox(off, 'term-normalize').element.disabled).toBe(true)

    const on = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    expect(checkbox(on, 'input-rewrite').element.disabled).toBe(false)
    expect(checkbox(on, 'term-normalize').element.disabled).toBe(false)
  })

  it('关闭态数值保留：置灰但仍回显勾选（再次打开即恢复）', () => {
    const wrapper = mountEditor({
      ...emptySoulDesign(),
      intent_focus: false,
      input_rewrite: true,
      term_normalize: true,
    })

    expect(checkbox(wrapper, 'input-rewrite').element.checked).toBe(true)
    expect(checkbox(wrapper, 'term-normalize').element.checked).toBe(true)
    expect(checkbox(wrapper, 'input-rewrite').element.disabled).toBe(true)
  })

  it('勾选上抛布尔值，且不影响另一个开关', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })

    await checkbox(wrapper, 'input-rewrite').setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.input_rewrite).toBe(true)
    expect(emitted.term_normalize).toBe(false)
    expect(typeof emitted.input_rewrite).toBe('boolean')
  })

  it('关闭意图聚焦只改开关，不动两个新开关的值', async () => {
    const wrapper = mountEditor({
      ...emptySoulDesign(),
      intent_focus: true,
      input_rewrite: true,
      term_normalize: true,
    })

    await wrapper.find<HTMLInputElement>('[data-test="intent-focus"]').setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(false)
    expect(emitted.input_rewrite).toBe(true)
    expect(emitted.term_normalize).toBe(true)
  })

  it('术语替换的前提在界面上写清（没有术语映射集时开启也不生效）', () => {
    const hint = mountEditor().find('[data-test="term-normalize-hint"]').text()

    expect(hint).toContain('仅当该数字人拥有本体术语映射集时，开启本功能才会生效')
  })

  it('输入重写说明只影响聚焦（用户消息与历史仍是原话）', () => {
    const hint = mountEditor().find('[data-test="input-rewrite-hint"]').text()

    expect(hint).toContain('改写只影响本轮聚焦')
    expect(hint).toContain('原话')
  })

  /**
   * 028：任务规划开关（意图聚焦配置区内）。
   *
   * 无障碍口径在组件自身用例内验证（宪章原则四）：原生 checkbox + 整行 label 即键盘可达，
   * 置灰语义与说明文案也要在这里断言，不能留给跨故事复核。
   */
  it('任务规划：意图聚焦关闭时置灰但保留已选值', () => {
    const off = mountEditor({ ...emptySoulDesign(), intent_focus: false, task_planning: true })
    expect(checkbox(off, 'task-planning').element.disabled).toBe(true)
    expect(checkbox(off, 'task-planning').element.checked).toBe(true)

    const on = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    expect(checkbox(on, 'task-planning').element.disabled).toBe(false)
    expect(checkbox(on, 'task-planning').element.checked).toBe(false)
  })

  it('任务规划：勾选上抛布尔值，且不动其它开关', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })

    await checkbox(wrapper, 'task-planning').setValue(true)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.task_planning).toBe(true)
    expect(emitted.input_rewrite).toBe(false)
    expect(emitted.term_normalize).toBe(false)
    expect(typeof emitted.task_planning).toBe('boolean')
  })

  it('任务规划：原生 checkbox + 整行 label（键盘可达）且说明文案写明前提', () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true })
    const input = checkbox(wrapper, 'task-planning').element

    expect(input.type).toBe('checkbox')
    expect(input.tabIndex).not.toBe(-1)
    expect(input.closest('label')).not.toBeNull()

    const hint = wrapper.find('[data-test="task-planning-hint"]').text()
    expect(hint).toContain('需同时开启意图聚焦')
  })

  it('任务规划：关闭意图聚焦只改开关，不丢本开关的值', async () => {
    const wrapper = mountEditor({ ...emptySoulDesign(), intent_focus: true, task_planning: true })

    await wrapper.find<HTMLInputElement>('[data-test="intent-focus"]').setValue(false)

    const emitted = wrapper.emitted('update:modelValue')?.at(-1)?.[0] as SoulDesign
    expect(emitted.intent_focus).toBe(false)
    expect(emitted.task_planning).toBe(true)
  })
})
