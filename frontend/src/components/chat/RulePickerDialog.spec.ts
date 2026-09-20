/**
 * 单元测试：算法规则选择弹窗（RulePickerDialog，HITL「从算法规则选择」）。
 *
 * 守住的语义：
 * - 展开时经 `load` 拉取最新规则文件；目录为空/解析失败展示可读错误
 * - 勾选行确认后原样生成 array[object]（键 = 表头列名，值 = 该行值）
 * - 优先级列就地编辑：数字文本转数字；留空则不携带该键
 * - 当前参数值里已有的行预勾选；0 条勾选时确认不可用
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { RuleFileResponse } from '../../api/types'
import RulePickerDialog from './RulePickerDialog.vue'

const RULES: RuleFileResponse = {
  filename: 'rules_20260919.xlsx',
  updated_at: '2026-09-19T08:00:00.000Z',
  columns: ['规则编码', '规则名称', '优先级'],
  rows: [
    { 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 },
    { 规则编码: 'R002', 规则名称: '需量控制', 优先级: 1 },
  ],
  priority_column: '优先级',
}

function mountDialog(options: {
  load?: () => Promise<RuleFileResponse>
  initialValue?: unknown
  open?: boolean
} = {}) {
  return mount(RulePickerDialog, {
    props: {
      open: options.open ?? true,
      fieldName: 'rules',
      initialValue: options.initialValue,
      load: options.load ?? (() => Promise.resolve(RULES)),
    },
  })
}

describe('RulePickerDialog', () => {
  it('展开时加载规则文件，渲染结构化表格（列 = 表头，优先级列为输入框）', async () => {
    const load = vi.fn(() => Promise.resolve(RULES))
    const wrapper = mountDialog({ load })
    await flushPromises()

    expect(load).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('rules_20260919.xlsx')
    const headers = wrapper.findAll('th')
    expect(headers.map((h) => h.text())).toEqual(['', '规则编码', '规则名称', '优先级'])
    const inputs = wrapper.findAll('.rule-picker__priority-input')
    expect(inputs).toHaveLength(2)
    expect((inputs[0]!.element as HTMLInputElement).value).toBe('3')
  })

  it('勾选行 + 就地改优先级 → 确认生成 array[object]（键 = 表头，值 = 行值）', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    // 未勾选时确认不可用
    expect(wrapper.findAll('button').find((b) => b.text().includes('确认选择'))!.attributes('disabled')).toBeDefined()

    const boxes = wrapper.findAll('tbody input[type="checkbox"]')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)

    // 就地改第 1 行优先级：5 → 数字；第 2 行留空 → 不携带该键
    await wrapper.findAll('.rule-picker__priority-input')[0]!.setValue('5')
    await wrapper.findAll('.rule-picker__priority-input')[1]!.setValue('')

    await wrapper.findAll('button').find((b) => b.text().includes('确认选择'))!.trigger('click')

    const events = wrapper.emitted('confirm')
    expect(events).toHaveLength(1)
    expect(events![0]![0]).toEqual([
      { 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 5 },
      { 规则编码: 'R002', 规则名称: '需量控制' },
    ])
  })

  it('当前参数值里已有的行预勾选', async () => {
    const wrapper = mountDialog({
      initialValue: [{ 规则编码: 'R002', 规则名称: '需量控制', 优先级: 1 }],
    })
    await flushPromises()

    const boxes = wrapper.findAll('tbody input[type="checkbox"]')
    expect((boxes[0]!.element as HTMLInputElement).checked).toBe(false)
    expect((boxes[1]!.element as HTMLInputElement).checked).toBe(true)
  })

  it('加载失败展示错误（目录为空/解析失败的可读结论）', async () => {
    const wrapper = mountDialog({ load: () => Promise.reject(new Error('「数据准备/算法规则」目录暂无文件')) })
    await flushPromises()

    expect(wrapper.text()).toContain('目录暂无文件')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('规则文件无数据行 → 展示空态', async () => {
    const wrapper = mountDialog({
      load: () => Promise.resolve({ ...RULES, rows: [] }),
    })
    await flushPromises()

    expect(wrapper.text()).toContain('没有数据行')
  })

  it('取消只发 close，不回写任何值', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })
})
