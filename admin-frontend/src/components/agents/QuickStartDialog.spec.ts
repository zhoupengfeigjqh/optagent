/**
 * 组件测试：「快速上手」编辑弹窗（004）。
 *
 * 覆盖 2026-10-10 的紧凑化改造：一条问题实例 = **一行**「序号 - 问题内容 - 移除」
 * + **可折叠**的关联工具（原生 `<details>`，summary 带已选计数）。
 * 同时守住既有语义：改的是本地副本、移除按索引、确定才提交。
 *
 * 注：弹窗打开后要先 `await flushPromises()`——组件在 `watch` 里 `await nextTick()`
 * 之后才把 props 拷进本地草稿。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import QuickStartDialog from './QuickStartDialog.vue'
import type { BuiltinTool, McpServiceListItem, SoulStarter, SoulStarterTool } from '../../api/types'

const BUILTIN_TOOLS: BuiltinTool[] = [
  { name: 'read_file', label: '读文件', description_template: '', parameters: {}, writable: false },
]

const MCP_SERVICES: McpServiceListItem[] = [
  {
    name: 'erp',
    description: '订单系统',
    transport: 'http',
    url: 'https://erp.example.com',
    has_headers: false,
    allowed_tools: ['query_order'],
  },
]

/** 第 1 条已挂一个内置工具，第 2 条干净——覆盖两种形态 */
function startersFixture(): SoulStarter[] {
  return [
    { prompt: '帮我梳理昨天订单的交付风险', tools: [{ kind: 'builtin', name: 'read_file' }] },
    { prompt: '这个月哪些订单可能延期？', tools: [] },
  ]
}

async function mountDialog() {
  const wrapper = mount(QuickStartDialog, {
    props: {
      open: true,
      welcome: '你好',
      starters: startersFixture(),
      enabledTools: ['read_file'],
      builtinTools: BUILTIN_TOOLS,
      mountedServices: ['erp'],
      mcpServices: MCP_SERVICES,
    },
  })
  await flushPromises()
  return wrapper
}

describe('QuickStartDialog —— 问题实例条目的紧凑布局', () => {
  it('一条实例 = 一行「序号 - 问题内容 - 移除」（三者同一行容器内）', async () => {
    const wrapper = await mountDialog()
    const rows = wrapper.findAll('.quick-start__row')

    expect(rows).toHaveLength(2)
    expect(rows[0]?.find('.quick-start__item-index').text()).toBe('1')
    expect(rows[0]?.find('textarea.quick-start__prompt').exists()).toBe(true)
    expect(rows[0]?.find('[data-test="quick-start-remove-0"]').exists()).toBe(true)
    expect(rows[1]?.find('.quick-start__item-index').text()).toBe('2')
  })

  it('问题内容用 aria-label + placeholder 承载（横排后标签文字让位，无障碍不降级）', async () => {
    const wrapper = await mountDialog()
    const input = wrapper.find('textarea.quick-start__prompt')

    expect(input.attributes('aria-label')).toBe('第 1 条问题内容')
    expect(input.attributes('placeholder')).toBeTruthy()
    expect(input.attributes('rows')).toBe('1')
  })

  it('内置工具候选用英文名在前、中文名在后（2026-10-17 与其它界面统一）', async () => {
    const wrapper = await mountDialog()

    const option = wrapper.find('[data-test="quick-start-tool-0-read_file"]')
    expect(option.exists()).toBe(true)
    expect(option.element.closest('label')?.textContent).toContain('read_file（读文件）')
  })

  it('关联工具默认收起，summary 显示已选计数（收起也不丢信息）', async () => {
    const wrapper = await mountDialog()
    const details = wrapper.findAll('details.quick-start__tools')

    expect(details[0]?.attributes('open')).toBeUndefined()
    expect(details[0]?.find('summary').text()).toContain('已选 1 /')
    expect(details[1]?.find('summary').text()).toContain('已选 0 /')
  })

  it('展开后勾选工具 → 确定时随 save 提交', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="quick-start-tool-0-read_file"]').setValue(false)
    await wrapper.find('[data-test="quick-start-tool-1-read_file"]').setValue(true)
    await wrapper.find('[data-test="quick-start-confirm"]').trigger('click')

    const saved = wrapper.emitted('save')?.[0]?.[0] as {
      starters: Array<{ prompt: string; tools: SoulStarterTool[] }>
    }
    expect(saved.starters[0]?.tools).toEqual([])
    expect(saved.starters[1]?.tools).toEqual([{ kind: 'builtin', name: 'read_file' }])
  })

  it('移除按索引：删掉第 1 条后只剩第 2 条', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-test="quick-start-remove-0"]').trigger('click')

    const rows = wrapper.findAll('.quick-start__row')
    expect(rows).toHaveLength(1)
    expect((rows[0]?.find('textarea').element as HTMLTextAreaElement).value).toBe(
      '这个月哪些订单可能延期？',
    )
  })
})
