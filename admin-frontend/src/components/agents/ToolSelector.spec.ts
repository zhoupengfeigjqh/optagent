/**
 * 组件测试：内置工具选择器（T059）
 *
 * 覆盖 props / emit / 边界：失效引用单独列出（`FR-013`）、
 * 说明以**占位符模板**原样呈现（`FR-012`、`SC-014`）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ToolSelector from './ToolSelector.vue'
import type { BuiltinTool } from '../../api/types'

const TOOLS: BuiltinTool[] = [
  {
    name: 'read_file',
    label: '读取文件',
    description_template: '参数 path 如 "{示例路径}"',
    parameters: { type: 'object' },
    writable: false,
  },
  {
    name: 'write_file',
    label: '写入临时文件',
    description_template: '文件名以 "{会话标识}_" 开头',
    parameters: { type: 'object' },
    writable: true,
  },
]

describe('ToolSelector', () => {
  it('渲染工具清单，说明保持占位符模板形态', () => {
    const wrapper = mount(ToolSelector, { props: { tools: TOOLS, modelValue: [] } })
    expect(wrapper.text()).toContain('读取文件')
    expect(wrapper.text()).toContain('{示例路径}')
    // 不出现任何具体用户目录名或会话标识（SC-014）
    expect(wrapper.text()).not.toContain('示例.csv')
  })

  it('writable 以可见标记区分（不只靠颜色）', () => {
    const wrapper = mount(ToolSelector, { props: { tools: TOOLS, modelValue: [] } })
    expect(wrapper.text()).toContain('可写')
    expect(wrapper.text()).toContain('只读')
  })

  it('勾选发出 update:modelValue（追加，保持既有顺序）', async () => {
    const wrapper = mount(ToolSelector, {
      props: { tools: TOOLS, modelValue: ['read_file'] },
    })
    const boxes = wrapper.findAll('input[type="checkbox"]')
    await boxes[1]?.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['read_file', 'write_file']])
  })

  it('取消勾选从选择集中移除', async () => {
    const wrapper = mount(ToolSelector, {
      props: { tools: TOOLS, modelValue: ['read_file', 'write_file'] },
    })
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['write_file']])
  })

  it('失效引用（目录中已不存在）单独列出并可移除（FR-013）', async () => {
    const wrapper = mount(ToolSelector, {
      props: { tools: TOOLS, modelValue: ['read_file', 'ghost_tool'] },
    })
    const orphans = wrapper.find('[data-test="orphans"]')
    expect(orphans.exists() || wrapper.text().includes('已失效')).toBe(true)
    expect(wrapper.text()).toContain('ghost_tool')

    const remove = wrapper.findAll('button').find((b) => b.text() === '移除')
    await remove?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['read_file']])
  })

  it('边界：目录为空时给出可读提示而非空白', () => {
    const wrapper = mount(ToolSelector, { props: { tools: [], modelValue: [] } })
    expect(wrapper.text()).toContain('运行环境未提供任何内置工具')
  })

  it('搜索按名称过滤，且不清空已选集合', async () => {
    const wrapper = mount(ToolSelector, {
      props: { tools: TOOLS, modelValue: ['write_file'] },
    })
    await wrapper.find('input[type="search"]').setValue('读取')
    expect(wrapper.findAll('[data-test="options"] li')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
