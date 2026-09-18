/**
 * 组件测试：工具调用人工确认弹窗（HITL，Schema 驱动通用表单）。
 *
 * 守住：
 * - 控件按 schema 类型映射：enum→下拉、boolean→开关、integer/number→数字、
 *   string→输入框（description 含「多行」→ 多行文本）、object/array→JSON 文本
 * - 预填 proposed_args 且可修改；required 标星 + 本地校验失败不 emit
 * - submit 只携带非空参数；reject 与倒计时归零都 emit reject
 * - 组件契约：仅依赖 request 输入，不含任何具体工具名（解耦红线）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import type { InteractionSnapshot } from '../../api/types'
import InteractionDialog from './InteractionDialog.vue'

function makeRequest(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    interaction_id: 'i_abc',
    call_id: 'c1',
    tool_name: 'some__tool',
    title: '确认调用参数：some__tool',
    schema: {
      type: 'object',
      properties: {
        产线: { type: 'string', description: '产线编号' },
        数量: { type: 'integer' },
        类型: { type: 'string', enum: ['峰', '谷'] },
        备注: { type: 'string', description: '多行备注' },
      },
      required: ['产线', '数量'],
    },
    proposed_args: { 产线: 'L01', 数量: 3, 类型: '峰' },
    required: ['产线', '数量'],
    timeout_seconds: 300,
    remaining_seconds: 300,
    ...overrides,
  }
}

function mountDialog(request: InteractionSnapshot = makeRequest()) {
  return mount(InteractionDialog, { props: { request } })
}

describe('InteractionDialog —— Schema 驱动表单', () => {
  it('按 schema 渲染控件：select/switch/number/textarea，并预填 proposed_args', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('select').exists()).toBe(true)
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('峰')
    expect(wrapper.find('input[type=number]').exists()).toBe(true)
    expect((wrapper.find('input[type=number]').element as HTMLInputElement).value).toBe('3')
    expect(wrapper.find('input[type=text]').exists()).toBe(true)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('L01')
    // description 含「多行」→ textarea
    expect(wrapper.find('textarea').exists()).toBe(true)

    // required 标星
    const labels = wrapper.findAll('.interaction-dialog__label')
    expect(labels[0]!.classes()).toContain('required')
    expect(labels[2]!.classes()).not.toContain('required')
  })

  it('提交：携带修改后的参数，跳过未填的可选项', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type=text]').setValue('L09')
    await wrapper.find('input[type=number]').setValue('5')

    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')

    const events = wrapper.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events![0]!).toEqual([{ 产线: 'L09', 数量: 5, 类型: '峰' }])
  })

  it('本地校验：必填缺失不 emit 并提示', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type=text]').setValue('')

    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('产线')
  })

  it('数字控件：非数字不 emit', async () => {
    const wrapper = mountDialog()
    // 直接注入非法值绕过浏览器约束
    const vm = wrapper.vm as unknown as { values: Record<string, unknown> }
    vm.values['数量'] = 'abc'

    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('数量')
  })

  it('JSON 控件：object/array 以 JSON 文本编辑，解析失败不 emit', async () => {
    const request = makeRequest({
      schema: {
        type: 'object',
        properties: {
          产线: { type: 'string' },
          数量: { type: 'integer' },
          类型: { type: 'string', enum: ['峰', '谷'] },
          备注: { type: 'string', description: '多行备注' },
          清单: { type: 'array', items: { type: 'integer' } },
        },
        required: ['产线', '数量'],
      },
      proposed_args: { 产线: 'L01', 数量: 3, 类型: '峰', 清单: [1, 2] },
    })
    const wrapper = mountDialog(request)

    // 预填序列化为 JSON 文本（可解析回同等结构）
    const area = wrapper.find('textarea.interaction-dialog__input--json')
    expect(JSON.parse((area.element as HTMLTextAreaElement).value)).toEqual([1, 2])

    await area.setValue('{bad json')
    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('清单')
  })

  it('拒绝按钮 emit reject', async () => {
    const wrapper = mountDialog()

    await wrapper.findAll('button').find((b) => b.text() === '拒绝调用')!.trigger('click')

    expect(wrapper.emitted('reject')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('服务端终验错误展示（serverError prop）', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ serverError: '参数「数量」须为整数' })

    expect(wrapper.find('.interaction-dialog__error').text()).toContain('须为整数')
  })

  it('无参数工具：展示确认提示，提交空对象', async () => {
    const wrapper = mountDialog(
      makeRequest({ schema: { type: 'object', properties: {} }, proposed_args: {}, required: [] }),
    )

    expect(wrapper.find('.interaction-dialog__empty').exists()).toBe(true)
    await wrapper.findAll('button').find((b) => b.text() === '确认提交')!.trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[{}]])
  })
})

describe('InteractionDialog —— 倒计时', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('倒计时归零自动按拒绝处理', async () => {
    const wrapper = mountDialog(makeRequest({ remaining_seconds: 2 }))

    await vi.advanceTimersByTimeAsync(2000)

    expect(wrapper.emitted('reject')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})
