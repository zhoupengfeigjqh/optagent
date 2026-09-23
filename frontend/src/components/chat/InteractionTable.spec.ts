/**
 * 组件测试：对象数组的表格块。
 *
 * 守住的语义：**一行一个元素**、表头 = 传入的列（顺序即 schema 声明列 + 值里动态列）、
 * 单元格路径 = 本路径 + [行下标, 列名]（下标不错位）、删行只上报事件（不自己改数据）、
 * 空态与异常行都有明确文案。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import {
  INTERACTION_FORM_KEY,
  createInteractionForm,
  type InteractionFormContext,
} from '../../composables/useInteractionForm'
import { propertiesOf, type FieldSchema } from '../../utils/arg-schema'
import InteractionTable from './InteractionTable.vue'

const ITEM: FieldSchema = {
  type: 'object',
  properties: { ruleId: { type: 'string' }, rulePriority: { type: 'integer' } },
  required: ['ruleId'],
}

const ROOT = { type: 'object', properties: { 清单: { type: 'array', items: ITEM } } }

function mountTable(rows: unknown[], columns: string[] = ['ruleId', 'rulePriority']) {
  const form = createInteractionForm({ schema: ROOT, proposed: { 清单: rows }, loadRules: vi.fn() })
  const context: InteractionFormContext = { form, mention: null, fileIndex: new Map() }
  const wrapper = mount(InteractionTable, {
    props: {
      path: ['清单'],
      columns,
      rows,
      itemSchema: ITEM,
      cellSchemaOf: (column: string) => propertiesOf(ITEM).find((item) => item.key === column)?.schema ?? {},
    },
    global: { provide: { [INTERACTION_FORM_KEY as symbol]: context } },
  })
  return { wrapper, form }
}

describe('InteractionTable —— 结构', () => {
  it('表头 = 传入的列（末尾是行操作列），一行一个元素', () => {
    const { wrapper } = mountTable([{ ruleId: 'PR001', rulePriority: 1 }, { ruleId: 'PR002', rulePriority: 2 }])

    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['ruleId', 'rulePriority', ''])
    expect(wrapper.findAll('tbody tr')).toHaveLength(2)
  })

  it('单元格按「本路径 + [行下标, 列名]」取值与回写（下标不错位）', async () => {
    const { wrapper, form } = mountTable([{ ruleId: 'PR001' }, { ruleId: 'PR002' }])

    const cells = wrapper.findAll('input[type=text]')
    expect((cells[0]!.element as HTMLInputElement).value).toBe('PR001')
    expect((cells[1]!.element as HTMLInputElement).value).toBe('PR002')

    await cells[1]!.setValue('PR009')

    expect(form.valueOf(['清单', 1, 'ruleId'])).toBe('PR009')
    expect(form.valueOf(['清单', 0, 'ruleId'])).toBe('PR001')
  })

  it('单元格控件由列 schema 决定（integer 列 → 数字输入）', () => {
    const { wrapper } = mountTable([{ ruleId: 'PR001', rulePriority: 3 }])

    const number = wrapper.find('input[type=number]')
    expect(number.attributes('aria-label')).toBe('rulePriority')
    expect((number.element as HTMLInputElement).value).toBe('3')
  })
})

describe('InteractionTable —— 交互与边界', () => {
  it('删行只上报下标（数据由父级改，组件不自己动）', async () => {
    const { wrapper } = mountTable([{ ruleId: 'PR001' }, { ruleId: 'PR002' }])

    await wrapper.findAll('.interaction-dialog__row-remove')[1]!.trigger('click')

    expect(wrapper.emitted('remove')).toEqual([[1]])
  })

  it('有列无行 → 提示尚未添加；无列无行 → 提示可用规则选择或 JSON 编辑', () => {
    expect(mountTable([]).wrapper.find('.interaction-dialog__table-empty').text()).toContain('尚未添加')

    const noColumns = mountTable([], [])
    expect(noColumns.wrapper.find('.interaction-dialog__table-empty').text()).toContain('从算法规则选择')
  })

  it('行不是对象时不渲染单元格，而是给出可操作文案（不静默）', () => {
    const { wrapper } = mountTable(['标量'])

    expect(wrapper.find('td.interaction-dialog__table-empty').text()).toContain('第 1 行不是对象')
    expect(wrapper.find('tbody input').exists()).toBe(false)
  })
})
