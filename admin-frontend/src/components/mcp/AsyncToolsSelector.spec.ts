/**
 * 单元测试：异步工具选择（R11）
 *
 * 覆盖三类场景（宪章原则三）：
 * - props：清单渲染与已声明项回显（含**清单外遗留项保留展示**，不静默丢弃）；
 * - emit：勾选 / 取消勾选、手填解析（去空白 / 丢空行 / 去重）；
 * - 边界：清单不可得（回退手填）、**忙态不锁控件**（契约 §0.5 原则 ③）、重复勾选不产生重复项。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AsyncToolsSelector from './AsyncToolsSelector.vue'

const TOOLS = [
  { name: 'submit_job', description: '提交后台任务', parameters: { type: 'object' } },
  { name: 'get_status', description: '查询任务状态', parameters: { type: 'object' } },
]

function mountSelector(modelValue: string[] = [], tools = TOOLS) {
  return mount(AsyncToolsSelector, { props: { modelValue, tools } })
}

/** 取最近一次 `update:modelValue` 的负载 */
function lastEmitted(wrapper: { emitted: (event: string) => unknown }): string[] | undefined {
  const events = wrapper.emitted('update:modelValue') as Array<[string[]]> | undefined
  return events?.at(-1)?.[0]
}

describe('AsyncToolsSelector —— 有清单（多选）', () => {
  it('渲染清单内工具，并回显已声明项的勾选状态', () => {
    const wrapper = mountSelector(['get_status'])
    const boxes = wrapper.findAll('input[type="checkbox"]')

    expect(boxes).toHaveLength(2)
    expect((boxes[0]!.element as HTMLInputElement).checked).toBe(false)
    expect((boxes[1]!.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('submit_job')
    expect(wrapper.text()).toContain('提交后台任务')
  })

  it('勾选 → 上报"追加后"的数组（不覆盖已选项）', async () => {
    const wrapper = mountSelector(['get_status'])
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)

    expect(lastEmitted(wrapper)).toEqual(['get_status', 'submit_job'])
  })

  it('取消勾选 → 上报不含该工具的数组', async () => {
    const wrapper = mountSelector(['submit_job', 'get_status'])
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)

    expect(lastEmitted(wrapper)).toEqual(['submit_job'])
  })

  it('重复勾选同一工具不产生重复项（与保存期"同服务内去重"口径一致）', async () => {
    const wrapper = mountSelector(['submit_job'])
    // 该框已是勾选态：`setValue(true)` 不触发 change，这里显式触发一次
    await wrapper.findAll('input[type="checkbox"]')[0]!.trigger('change')

    expect(lastEmitted(wrapper)).toEqual(['submit_job'])
  })
})

describe('AsyncToolsSelector —— 清单外遗留项', () => {
  it('已声明但不在当前清单：仍展示（可能是清单截断或服务改版）', () => {
    const wrapper = mountSelector(['legacy_tool'])
    const boxes = wrapper.findAll('input[type="checkbox"]')

    expect(boxes).toHaveLength(3) // 2 个清单项 + 1 个遗留项
    expect(wrapper.text()).toContain('legacy_tool')
    expect(wrapper.text()).toContain('未包含')
  })

  it('取消遗留项 → 从声明中移除', async () => {
    const wrapper = mountSelector(['legacy_tool'])
    await wrapper.findAll('input[type="checkbox"]')[2]!.setValue(false)

    expect(lastEmitted(wrapper)).toEqual([])
  })
})

describe('AsyncToolsSelector —— 清单不可得（回退手填）', () => {
  it('无清单：渲染文本域而不是复选框（服务抖动不该让配置改不了）', () => {
    const wrapper = mountSelector(['submit_job'], [])

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
  })

  it('手填：去空白、丢空行、去重后上报', async () => {
    const wrapper = mountSelector([], [])
    await wrapper.find('textarea').setValue('  submit_job  \n\nsubmit_job\nget_status\n')

    expect(lastEmitted(wrapper)).toEqual(['submit_job', 'get_status'])
  })
})

describe('AsyncToolsSelector —— 边界', () => {
  it('忙态不锁控件：复选框与文本域 MUST NOT 带 disabled（契约 §0.5 原则 ③）', () => {
    // 本组件**不接收** busy/disabled 入口：保存进行态只由动作按钮表达。
    // 控件级禁用会在百毫秒级的保存来回中退化成"闪一下"（2026-09-25 实测缺陷）。
    const withCatalog = mountSelector(['submit_job'], TOOLS)
    const boxes = withCatalog.findAll('input[type="checkbox"]')
    expect(boxes.length).toBeGreaterThan(0)
    expect(boxes.every((b) => b.attributes('disabled') === undefined)).toBe(true)

    const manual = mountSelector([], [])
    expect(manual.find('textarea').attributes('disabled')).toBeUndefined()
  })

  it('空声明 + 无清单：文本域为空（不残留占位内容）', () => {
    const wrapper = mountSelector([], [])
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })
})
