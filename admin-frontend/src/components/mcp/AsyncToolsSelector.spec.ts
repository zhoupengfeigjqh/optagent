/**
 * 单元测试：异步工具选择（R11）
 *
 * 覆盖四类场景（宪章原则三）：
 * - props：**只渲染含 `result_url` 的工具**（2026-10-03 产品决定）、已声明项回显；
 * - emit：勾选 / 取消勾选、手填解析（去空白 / 丢空行 / 去重）；
 * - 边界：清单不可得（回退手填 + 原因）、清单被截断（手填逃生门）、
 *   **已声明但不在可选范围内仍保留展示可取消**（防"看不见的僵尸声明"）、
 *   **忙态不锁控件**（契约 §0.5 原则 ③）、重复勾选不产生重复项。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AsyncToolsSelector from './AsyncToolsSelector.vue'

/** 支持异步：入参 schema 声明了 `result_url`（与运行期注入判据一致） */
const ASYNC_TOOL = {
  name: 'submit_job',
  description: '提交后台任务',
  parameters: {
    type: 'object',
    properties: { result_url: { type: 'string', description: '结果回写地址' } },
  },
}
/** 同步工具：未声明 `result_url` → 不出现在可选项里 */
const SYNC_TOOL = {
  name: 'get_status',
  description: '查询任务状态',
  parameters: { type: 'object', properties: { job_id: { type: 'string' } } },
}
const TOOLS = [ASYNC_TOOL, SYNC_TOOL]

function mountSelector(
  modelValue: string[] = [],
  tools = TOOLS,
  extra: { toolsError?: string | null; toolsTruncated?: boolean } = {},
) {
  return mount(AsyncToolsSelector, { props: { modelValue, tools, ...extra } })
}

/** 取最近一次 `update:modelValue` 的负载 */
function lastEmitted(wrapper: { emitted: (event: string) => unknown }): string[] | undefined {
  const events = wrapper.emitted('update:modelValue') as Array<[string[]]> | undefined
  return events?.at(-1)?.[0]
}

describe('AsyncToolsSelector —— 有清单（只列支持异步的工具）', () => {
  it('只渲染含 result_url 的工具；未声明的工具不展示', () => {
    const wrapper = mountSelector(['submit_job'])
    const boxes = wrapper.findAll('input[type="checkbox"]')

    expect(boxes).toHaveLength(1)
    expect((boxes[0]!.element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.text()).toContain('submit_job')
    expect(wrapper.text()).not.toContain('get_status')
  })

  it('勾选 → 上报"追加后"的数组（不覆盖已选项）', async () => {
    const wrapper = mountSelector([])
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true)

    expect(lastEmitted(wrapper)).toEqual(['submit_job'])
  })

  it('取消勾选 → 上报不含该工具的数组', async () => {
    const wrapper = mountSelector(['submit_job'])
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)

    expect(lastEmitted(wrapper)).toEqual([])
  })

  it('重复勾选同一工具不产生重复项（与保存期"同服务内去重"口径一致）', async () => {
    const wrapper = mountSelector(['submit_job'])
    // 该框已是勾选态：`setValue(true)` 不触发 change，这里显式触发一次
    await wrapper.findAll('input[type="checkbox"]')[0]!.trigger('change')

    expect(lastEmitted(wrapper)).toEqual(['submit_job'])
  })

  it('清单里没有任何支持异步的工具 → 显示「当前没有异步计算工具」，不给空勾选组', () => {
    const wrapper = mountSelector([], [SYNC_TOOL])

    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('当前没有异步计算工具')
    // 空态与「URL铸造参数设置」同一呈现：`field__hint` 单行提示
    expect(wrapper.find('p.field__hint').exists()).toBe(true)
  })
})

describe('AsyncToolsSelector —— 已声明但不在可选范围内', () => {
  it('已声明却未声明 result_url / 不在清单：仍保留展示并提示不会生效', () => {
    const wrapper = mountSelector(['get_status', 'legacy_tool'])
    const boxes = wrapper.findAll('input[type="checkbox"]')

    // 1 个可选（submit_job）+ 2 个越界（get_status / legacy_tool）
    expect(boxes).toHaveLength(3)
    expect(wrapper.text()).toContain('get_status')
    expect(wrapper.text()).toContain('legacy_tool')
    expect(wrapper.text()).toContain('声明不会生效')
  })

  it('取消越界声明 → 从声明中移除（否则它会持续告警却无从取消）', async () => {
    const wrapper = mountSelector(['get_status', 'legacy_tool'])
    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[1]!.setValue(false) // get_status

    expect(lastEmitted(wrapper)).toEqual(['legacy_tool'])
  })
})

describe('AsyncToolsSelector —— 清单不可得（回退手填）', () => {
  it('无清单：渲染文本域而不是复选框，并给出不可得原因', () => {
    const wrapper = mountSelector(['submit_job'], [], {
      toolsError: 'MCP 服务 hd-algorithm 不可达：连接或调用超时',
    })

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('工具清单不可得')
    expect(wrapper.text()).toContain('超时')
  })

  it('手填：去空白、丢空行、去重后上报', async () => {
    const wrapper = mountSelector([], [])
    await wrapper.find('textarea').setValue('  submit_job  \n\nsubmit_job\nget_status\n')

    expect(lastEmitted(wrapper)).toEqual(['submit_job', 'get_status'])
  })
})

describe('AsyncToolsSelector —— 清单被截断', () => {
  it('截断时给出手填逃生门与提示（未展示的工具无从判断）', () => {
    const wrapper = mountSelector([], TOOLS, { toolsTruncated: true })

    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('被截断')
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
