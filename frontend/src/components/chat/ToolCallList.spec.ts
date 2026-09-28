/**
 * 工具调用卡片测试（002 特性）
 *
 * 守住三条用户可感知的行为：
 * 1. **内联结果展开即见**（不额外发请求）
 * 2. **外置结果点开才拉取**，且拉取失败要区分"已清理"（降级）与"加载失败"（可重试）
 * 3. **running 记录**（只有开始事件）渲染为"进行中，暂无结果"，不假装有内容
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { ToolCallResult } from '../../api/types'
import type { ToolCallItem } from '../../utils/tool-calls'
import ToolCallList from './ToolCallList.vue'

function mountList(
  items: ToolCallItem[],
  loadResult?: (callId: string) => Promise<ToolCallResult>,
) {
  return mount(ToolCallList, {
    props: loadResult ? { items, loadResult } : { items },
  })
}

describe('ToolCallList —— 卡片展示', () => {
  it('展示工具名、状态、耗时与体积', () => {
    const wrapper = mountList([
      { callId: 'c1', name: 'read_file', status: 'success', durationMs: 84, size: 120 },
    ])

    expect(wrapper.text()).toContain('本轮调用 1 个工具')
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
    const wrapper = mountList([
      {
        callId: 'c1',
        name: 'read_file',
        status: 'success',
        argsDigest: { path: '数据准备/生产计划/9月计划.xlsx' },
      },
    ])

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
  it('只有开始事件（running）：显示"进行中，暂无结果"', async () => {
    const wrapper = mountList([{ callId: 'c1', name: 'ocr', status: 'running' }])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('进行中')
    expect(wrapper.text()).toContain('进行中，暂无结果')
  })

  it('结果被落盘上限截断：给出明确提示', async () => {
    const wrapper = mountList([
      { callId: 'c1', name: 'ocr', status: 'success', content: '前半部分', truncated: true },
    ])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('结果过大，仅保留了前一部分')
  })
})
