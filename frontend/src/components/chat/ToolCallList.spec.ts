/**
 * 工具调用卡片测试（002 特性）
 *
 * 守住用户可感知的行为：
 * 1. **计数与报错数常显**（TR-32）：折叠态就能看出"几次调用、有没有失败"
 * 2. **折叠与明细**（TR-34 / TR-35）：≥2 次时只露最新一条，点摘要行才看全部（时间正序）；
 *    只有 1 次时不设折叠层
 * 3. **可展开性**（TR-33）：只有终态可展开；运行中不可展开且不出现"展开"字样；
 *    `running` 文案按 live 分流（进行中 / 未完成）
 * 4. **结果展示与降级**（TR-15 / TR-16）：内联结果展开即见；外置结果点开才拉取；
 *    已清理（410）降级为"已清理"而非错误；加载失败可重试；截断有明确提示
 * 5. **查看态跨"流式 → 历史"交接保持**（TR-36）
 */
import { flushPromises, mount } from '@vue/test-utils'
import { h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToolCallResult } from '../../api/types'
import { useToolPanels } from '../../composables/useToolPanels'
import type { ToolCallItem } from '../../utils/tool-calls'
import ToolCallList from './ToolCallList.vue'

const READ: ToolCallItem = {
  callId: 'c1',
  name: 'read_file',
  status: 'success',
  durationMs: 84,
  size: 120,
  argsDigest: { path: '数据准备/生产计划/9月计划.xlsx' },
}
/** 外置结果 + 失败：用于"报错数"与"懒加载"两类断言 */
const QUERY: ToolCallItem = {
  callId: 'c2',
  name: 'sql_query',
  status: 'error',
  durationMs: 210,
  size: 8192,
  artifactSize: 8192,
  summary: '连接排产库失败',
}
const OCR: ToolCallItem = { callId: 'c3', name: 'ocr_image', status: 'running' }

function mountList(
  items: ToolCallItem[],
  loadResult?: (callId: string) => Promise<ToolCallResult>,
  live?: boolean,
) {
  return mount(ToolCallList, {
    props: { items, ...(loadResult ? { loadResult } : {}), ...(live === undefined ? {} : { live }) },
  })
}

beforeEach(() => {
  // 查看态是模块级单例（TR-36）：不清空会把上一个用例的展开态带进来
  useToolPanels().reset()
})

describe('ToolCallList —— 计数与报错数（TR-32）', () => {
  it('计数常显：次数口径 + 报错数（不展开也能看出有失败）', () => {
    const wrapper = mountList([READ, QUERY, OCR])

    const counts = wrapper.find('[data-test="tool-counts"]').text()
    expect(counts).toContain('本轮 3 次调用')
    expect(counts).toContain('报错 1 次')
  })

  it('报错数为 0 时也显示（"没看到红字"等于"确实没异常"，而不是"不知道有没有"）', () => {
    const wrapper = mountList([READ])
    expect(wrapper.find('[data-test="tool-counts"]').text()).toContain('报错 0 次')
  })

  it('running 不计入报错（它既不是成功也不是失败）', () => {
    const wrapper = mountList([OCR])
    expect(wrapper.find('[data-test="tool-counts"]').text()).toContain('报错 0 次')
  })
})

describe('ToolCallList —— 折叠与明细（TR-34 / TR-35）', () => {
  it('≥2 次调用时折叠为一行摘要：只露最新一条，明细区不存在', () => {
    const wrapper = mountList([READ, QUERY, OCR])

    const summary = wrapper.find('[data-test="tool-summary"]')
    expect(summary.text()).toContain('最新')
    expect(summary.text()).toContain('ocr_image') // 最新一条 = 最后到达的那次调用
    expect(summary.text()).toContain('查看明细')
    expect(wrapper.find('[data-test="tool-details"]').exists()).toBe(false)
  })

  it('点摘要行展开明细：本轮全部调用、时间正序（最早在上）', async () => {
    const wrapper = mountList([READ, QUERY, OCR])

    await wrapper.find('[data-test="tool-summary"]').trigger('click')

    const details = wrapper.find('[data-test="tool-details"]')
    expect(details.exists()).toBe(true)
    expect(details.findAll('.tool-call__name').map((node) => node.text())).toEqual([
      'read_file',
      'sql_query',
      'ocr_image',
    ])
    // 明细里的失败项自带状态文案与耗时（不只靠颜色）
    expect(details.text()).toContain('失败')
    expect(details.text()).toContain('210ms')
  })

  it('再点摘要行收起明细', async () => {
    const wrapper = mountList([READ, QUERY])
    const summary = wrapper.find('[data-test="tool-summary"]')

    await summary.trigger('click')
    expect(summary.text()).toContain('收起明细')
    await summary.trigger('click')
    expect(summary.text()).toContain('查看明细')
    expect(wrapper.find('[data-test="tool-details"]').exists()).toBe(false)
  })

  it('摘要行是按钮且与明细区用 aria-expanded / aria-controls 关联', async () => {
    const wrapper = mountList([READ, QUERY])
    const summary = wrapper.find('[data-test="tool-summary"]')
    const controls = summary.attributes('aria-controls') ?? ''

    expect(summary.element.tagName).toBe('BUTTON')
    expect(summary.attributes('aria-expanded')).toBe('false')
    expect(wrapper.find(`[id="${controls}"]`).exists()).toBe(false)

    await summary.trigger('click')
    expect(summary.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find(`[id="${controls}"]`).exists()).toBe(true)
  })

  it('同一个应用内多个实例的明细区 id 不同（否则 aria-controls 会指错）', () => {
    // 必须挂在**同一个 app** 下才是真实场景（每条消息一个实例）；两次 mount 是两个 app，
    // 而 `useId()` 的计数是应用级的，那样比不出东西来。
    const host = mount({
      render: () => h('div', [h(ToolCallList, { items: [READ, QUERY] }), h(ToolCallList, { items: [READ, QUERY] })]),
    })

    const ids = host
      .findAll('[data-test="tool-summary"]')
      .map((node) => node.attributes('aria-controls'))
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })

  it('只有 1 次调用时不设折叠层：无摘要行，点卡片即看结果', async () => {
    const wrapper = mountList([{ ...READ, content: '车间,计划量' }])

    expect(wrapper.find('[data-test="tool-summary"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="tool-counts"]').text()).toContain('本轮 1 次调用')
    // 唯一的卡片直接可见（不存在"两层点击"）
    expect(wrapper.find('.tool-call__head').text()).toContain('read_file')

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('车间,计划量')
  })
})

describe('ToolCallList —— 可展开性（TR-33）', () => {
  it('运行中的调用不可展开：无"展开"字样、按钮禁用、点了也不出结果体', async () => {
    const wrapper = mountList([OCR], undefined, true)

    const head = wrapper.find('.tool-call__head')
    expect(head.text()).toContain('进行中')
    expect(head.text()).not.toContain('展开')
    expect(head.attributes('disabled')).toBeDefined()
    expect(head.attributes('aria-expanded')).toBeUndefined()

    await head.trigger('click')
    expect(wrapper.find('.tool-call__body').exists()).toBe(false)
  })

  it('running 文案分流：流式=进行中；历史里中途退出（不会再动）=未完成', () => {
    const streaming = mountList([OCR], undefined, true)
    expect(streaming.text()).toContain('进行中')

    // 历史态（非 live）：进程中途退出，只有开始行——不许说成"进行中"
    const history = mountList([OCR])
    expect(history.text()).toContain('未完成')
    expect(history.text()).not.toContain('进行中')
  })

  it('明细里运行中的条目同样不可展开（规则不分位置）', async () => {
    const wrapper = mountList([READ, OCR], undefined, true)
    await wrapper.find('[data-test="tool-summary"]').trigger('click')

    const rows = wrapper.findAll('.tool-call__head')
    expect(rows[0]?.text()).toContain('展开') // read_file 已完成 → 可展开
    expect(rows[1]?.text()).toContain('ocr_image')
    expect(rows[1]?.text()).not.toContain('展开')
    expect(rows[1]?.attributes('disabled')).toBeDefined()
  })
})

describe('ToolCallList —— 卡片展示', () => {
  it('展示工具名、状态、耗时与体积', () => {
    const wrapper = mountList([READ])

    expect(wrapper.text()).toContain('read_file')
    expect(wrapper.text()).toContain('已完成')
    expect(wrapper.text()).toContain('84ms')
    expect(wrapper.text()).toContain('120 B')
  })

  it('无记录时不渲染任何内容（调用方无需判空）', () => {
    const wrapper = mountList([])
    expect(wrapper.find('.tool-calls').exists()).toBe(false)
  })

  it('展开后显示入参摘要（说明"查了什么"）', async () => {
    const wrapper = mountList([READ])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('入参：path=数据准备/生产计划/9月计划.xlsx')
  })
})

describe('ToolCallList —— 内联结果', () => {
  it('内联结果展开即见，且不发起任何加载请求', async () => {
    const loadResult = vi.fn()
    const wrapper = mountList(
      [{ callId: 'c1', name: 'read_file', status: 'success', content: '车间,计划量\n冲压,1200' }],
      loadResult,
    )

    expect(wrapper.text()).not.toContain('冲压,1200')
    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('冲压,1200')
    expect(loadResult).not.toHaveBeenCalled()
  })
})

describe('ToolCallList —— 外置结果懒加载与降级', () => {
  it('外置结果：点开才拉取，拉到后展示正文', async () => {
    const loadResult = vi.fn(
      (_callId: string): Promise<ToolCallResult> =>
        Promise.resolve({
          call_id: 'c1',
          name: 'ocr_image',
          status: 'success',
          size: 1843200,
          content: '识别到 12 页产能表',
        }),
    )
    const wrapper = mountList(
      [
        {
          callId: 'c1',
          name: 'ocr_image',
          status: 'success',
          artifactSize: 1843200,
          summary: '识别到 12 页产能表',
        },
      ],
      loadResult,
    )

    expect(loadResult).not.toHaveBeenCalled()
    await wrapper.find('.tool-call__head').trigger('click')
    expect(loadResult).toHaveBeenCalledWith('c1')
    await flushPromises()
    expect(wrapper.text()).toContain('识别到 12 页产能表')
  })

  it('正文已被临时空间清理（410）：降级为"已清理"，不当成错误', async () => {
    const loadResult = vi.fn(() =>
      Promise.reject(Object.assign(new Error('已被清理'), { code: 'TOOL_RESULT_EXPIRED' })),
    )
    const wrapper = mountList(
      [{ callId: 'c1', name: 'ocr_image', status: 'success', artifactSize: 1843200 }],
      loadResult,
    )

    await wrapper.find('.tool-call__head').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('内容已被临时空间清理')
    expect(wrapper.text()).toContain('1.8 MB')
  })

  it('其他加载失败：提示可重试（与"已清理"区分）', async () => {
    const loadResult = vi.fn(() => Promise.reject(new Error('网络错误')))
    const wrapper = mountList(
      [{ callId: 'c1', name: 'ocr_image', status: 'success', artifactSize: 2048 }],
      loadResult,
    )

    await wrapper.find('.tool-call__head').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('内容加载失败')
  })

  it('重复展开不重复请求（同一卡片只拉一次）', async () => {
    const loadResult = vi.fn(() =>
      Promise.resolve({
        call_id: 'c1',
        name: 'ocr',
        status: 'success' as const,
        size: 4096,
        content: '正文',
      }),
    )
    const wrapper = mountList(
      [{ callId: 'c1', name: 'ocr', status: 'success', artifactSize: 4096 }],
      loadResult,
    )

    await wrapper.find('.tool-call__head').trigger('click')
    await flushPromises()
    await wrapper.find('.tool-call__head').trigger('click') // 收起
    await wrapper.find('.tool-call__head').trigger('click') // 再展开
    await flushPromises()
    expect(loadResult).toHaveBeenCalledTimes(1)
  })
})

describe('ToolCallList —— 未完成的调用', () => {
  it('结果被落盘上限截断：给出明确提示', async () => {
    const wrapper = mountList([
      { callId: 'c1', name: 'ocr', status: 'success', content: '前半部分', truncated: true },
    ])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('结果过大，仅保留了前一部分')
  })
})

describe('ToolCallList —— 查看态跨"流式 → 历史"交接保持（TR-36）', () => {
  it('展开明细与正文后重挂载（组件实例重建）：仍保持展开，且不重复请求', async () => {
    const loadResult = vi.fn(
      (_callId: string): Promise<ToolCallResult> =>
        Promise.resolve({
          call_id: 'c2',
          name: 'sql_query',
          status: 'error',
          size: 8192,
          content: '连接排产库失败：timeout',
        }),
    )
    const items = [READ, QUERY]

    const streaming = mountList(items, loadResult, true)
    await streaming.find('[data-test="tool-summary"]').trigger('click')
    await streaming.findAll('.tool-call__head')[1]!.trigger('click')
    await flushPromises()
    expect(loadResult).toHaveBeenCalledTimes(1)
    expect(streaming.text()).toContain('连接排产库失败：timeout')
    streaming.unmount()

    // 交接：流式气泡卸载、历史消息挂载 → 全新的组件实例、同一轮数据
    const history = mountList(items, loadResult)
    expect(history.find('[data-test="tool-details"]').exists()).toBe(true)
    expect(history.text()).toContain('连接排产库失败：timeout')
    expect(loadResult).toHaveBeenCalledTimes(1)
  })
})
