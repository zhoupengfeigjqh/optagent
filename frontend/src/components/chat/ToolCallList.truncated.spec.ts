/**
 * 工具卡片的**截断展示**（2026-11-07，2026-11-08 简化为"只展示记录里的正文"）。
 *
 * 文案判定本身在 `utils/tool-result-hint.spec.ts` 穷举（纯函数）；
 * 这里只守组件真正负责的两件事：
 * 1. 内置工具（无 `artifact_size`）展开即见截断版，提示里明说"完整内容未保存"；
 * 2. 外部来源（有 `artifact_size`）展开同样只显示记录里的截断版——**不发起请求**，
 *    提示说明完整副本的体积与位置。
 *
 * 为什么单独一个文件：`ToolCallList.spec.ts` 已逼近 500 行门禁（宪章原则二）。
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { useToolPanels } from '../../composables/useToolPanels'
import type { ToolCallItem } from '../../utils/tool-calls'
import ToolCallList from './ToolCallList.vue'

function mountList(items: ToolCallItem[]) {
  return mount(ToolCallList, { props: { items } })
}

beforeEach(() => {
  // 查看态是模块级单例（TR-36）：不清空会把上一个用例的展开态带进来
  useToolPanels().reset()
})

describe('ToolCallList —— 截断展示（2026-11-08）', () => {
  it('内置工具截断内联：展开即见截断版 + "完整内容未保存"', async () => {
    const wrapper = mountList([
      {
        callId: 'c1',
        name: 'read_file',
        status: 'success',
        content: '前半部分',
        truncated: true,
      },
    ])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('前半部分')
    expect(wrapper.text()).toContain('结果过大，仅保留了前一部分')
    expect(wrapper.text()).toContain('完整内容未保存')
  })

  it('外部来源：只展示记录里的截断版，并说明完整副本的体积与位置', async () => {
    const wrapper = mountList([
      {
        callId: 'c2',
        name: 'mcp_sql_query',
        status: 'success',
        content: '前半部分',
        artifactSize: 1843200,
        size: 1843200,
        truncated: true,
      },
    ])

    await wrapper.find('.tool-call__head').trigger('click')
    expect(wrapper.text()).toContain('前半部分')
    expect(wrapper.text()).toContain('结果过大，仅显示前一部分')
    expect(wrapper.text()).toContain('完整正文 1.8 MB 存于临时空间')
    // 关键：不再有"未保存"的说法——副本确实在磁盘上
    expect(wrapper.text()).not.toContain('完整内容未保存')
  })
})
