/**
 * 组件测试：MCP 工具清单（`FR-045`、`FR-063`）
 *
 * 守住四组口径：
 * 1. **只显示白名单里的工具**（顺序与白名单一致）；白名单为空（存量服务 = 不限制）则显示服务全量；
 * 2. **白名单失效标异常**：白名单里但当前服务清单中已不存在的工具 → 叹号 + 汇总；
 *    **探测失败时不能这么判**（核对不了 ≠ 不存在），只显示可读原因（`FR-009` 不静默省略）；
 * 3. 「重新探测」按钮（2026-10-02）：清单是打开详情那一刻的探测快照，界面不自动重取；
 * 4. 探测进行中（`busy`）按钮禁用并改文案，防止重复点击。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import McpToolList from './McpToolList.vue'
import type { McpToolInfo } from '../../api/types'

const TOOLS: McpToolInfo[] = [
  { name: 'ocr_image', description: '识别图片', parameters: { type: 'object' } },
  { name: 'query_price', description: '', parameters: {} },
]

function mountList(
  tools: McpToolInfo[],
  extra: {
    allowedTools?: string[]
    missingTools?: string[]
    truncated?: boolean
    errorMessage?: string | null
    busy?: boolean
  } = {},
) {
  return mount(McpToolList, {
    props: {
      tools,
      allowedTools: extra.allowedTools ?? [],
      missingTools: extra.missingTools ?? [],
      truncated: extra.truncated ?? false,
      errorMessage: extra.errorMessage ?? null,
      busy: extra.busy ?? false,
    },
  })
}

describe('McpToolList —— 白名单渲染', () => {
  it('有白名单：按白名单顺序逐个展示工具名与说明，缺说明给可读兜底', () => {
    const wrapper = mountList(TOOLS, { allowedTools: ['query_price', 'ocr_image'] })

    const items = wrapper.findAll('.mcp-tool-list__item')
    expect(items).toHaveLength(2)
    expect(items[0]?.text()).toContain('query_price')
    expect(items[0]?.text()).toContain('（无说明）')
    expect(items[1]?.text()).toContain('ocr_image')
    expect(items[1]?.text()).toContain('识别图片')
  })

  it('白名单为空（存量服务 = 不限制）：显示服务全量并说明"未限定工具范围"', () => {
    const wrapper = mountList(TOOLS)

    expect(wrapper.text()).toContain('该服务未限定工具范围')
    expect(wrapper.findAll('.mcp-tool-list__item')).toHaveLength(2)
  })

  it('白名单指向的工具已不存在 → 逐条叹号 + 顶部汇总（失效提示）', () => {
    const wrapper = mountList(TOOLS, {
      allowedTools: ['ocr_image', 'gone_tool'],
      missingTools: ['gone_tool'],
    })

    const items = wrapper.findAll('.mcp-tool-list__item')
    expect(items).toHaveLength(2)
    const missing = wrapper.find('.mcp-tool-list__item--missing')
    expect(missing.text()).toContain('gone_tool')
    expect(missing.text()).toContain('已不存在')
    expect(wrapper.find('[data-test="missing-summary"]').text()).toContain('gone_tool')
  })

  it('白名单全失效 → 全部标异常（不显示成"没有工具"）', () => {
    const wrapper = mountList([], { allowedTools: ['gone_a'], missingTools: ['gone_a'] })

    expect(wrapper.findAll('.mcp-tool-list__item--missing')).toHaveLength(1)
  })

  it('服务无工具且未限定范围：明确说"未声明任何工具"（不静默空白）', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('该服务未声明任何工具')
    expect(wrapper.find('.mcp-tool-list__items').exists()).toBe(false)
  })

  it('探测失败：只显示可读原因，且 MUST NOT 把白名单判成"已不存在"', () => {
    const wrapper = mountList(TOOLS, {
      allowedTools: ['ocr_image', 'gone_tool'],
      errorMessage: '连接被拒绝',
    })

    const text = wrapper.find('.mcp-tool-list__error').text()
    expect(text).toContain('工具清单不可得：连接被拒绝')
    expect(text).toContain('无法核对')
    expect(wrapper.find('.mcp-tool-list__items').exists()).toBe(false)
    expect(wrapper.find('[data-test="missing-summary"]').exists()).toBe(false)
  })

  it('清单被截断时给出说明（有界返回不静默）', () => {
    const wrapper = mountList(TOOLS, { truncated: true })

    expect(wrapper.text()).toContain('工具数量超过上限')
  })
})

describe('McpToolList —— 重新探测', () => {
  it('点击「重新探测」向上 emit reprobe（由详情页转发 reload）', async () => {
    const wrapper = mountList(TOOLS)

    await wrapper.find('[data-test="reprobe"]').trigger('click')

    expect(wrapper.emitted('reprobe')).toEqual([[]])
  })

  it('探测进行中（busy）：按钮禁用并显示"探测中…"，防重复点击', () => {
    const wrapper = mountList(TOOLS, { busy: true })

    const btn = wrapper.find('[data-test="reprobe"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toBe('探测中…')
  })
})
