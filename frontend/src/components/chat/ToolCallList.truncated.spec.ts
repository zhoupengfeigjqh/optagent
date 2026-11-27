import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { useToolPanels } from '../../composables/useToolPanels'
import type { ToolCallItem } from '../../utils/tool-calls'
import ToolCallList from './ToolCallList.vue'

function mountList(items: ToolCallItem[]) {
  return mount(ToolCallList, { props: { items } })
}

beforeEach(() => {
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
    expect(wrapper.text()).not.toContain('完整内容未保存')
  })
})
