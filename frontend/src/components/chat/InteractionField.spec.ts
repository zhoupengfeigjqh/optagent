/**
 * 组件测试：HITL 弹窗的单个入参节点（递归渲染）。
 *
 * 守住的语义：
 * - 控件形态**只**由 schema 推导：标量→行内控件、对象→子字段逐行（递归）、
 *   对象数组→表格（列 = schema 声明列 + 值里的动态列）、标量数组→列表、
 *   schema 表达不了的形状→JSON 逃生舱；
 * - 规则入口落在**目标那一行**（与它要影响的表格同属一个字段块），确认后深写回模型；
 * - `cell` 模式只出控件本体；无上下文时不渲染（边界）。
 */
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import type { RuleFileResponse, WorkspaceFile } from '../../api/types'
import type { PathInsertStore } from '../../composables/usePathInsert'
import {
  createInteractionForm,
  INTERACTION_FORM_KEY,
  type InteractionFormContext,
} from '../../composables/useInteractionForm'
import { asSchema, schemaAtPath } from '../../utils/arg-schema'
import type { NodePath } from '../../utils/json-path'
import InteractionField from './InteractionField.vue'

const RULES: RuleFileResponse = {
  filename: 'rules_20260923.xlsx',
  updated_at: '2026-09-23T00:00:00.000Z',
  columns: ['ruleId', 'rulePriority'],
  rows: [{ ruleId: 'PR001', rulePriority: 1 }],
  priority_column: 'rulePriority',
}

/** 最复杂的真实形态（外部排产服务）：嵌套对象 + 对象数组 + 行内 required。仅作回归样本。 */
const NESTED = {
  type: 'object',
  properties: {
    uid: { type: 'string' },
    input: {
      type: 'object',
      properties: {
        solvingTime: { type: 'integer' },
        targetPriorities: {
          type: 'array',
          items: {
            type: 'object',
            properties: { ruleId: { type: 'string' }, rulePriority: { type: 'integer' } },
            required: ['ruleId', 'rulePriority'],
          },
        },
      },
      required: ['solvingTime', 'targetPriorities'],
    },
  },
  required: ['uid', 'input'],
}

const NESTED_PROPOSED = {
  uid: 'admin',
  input: { solvingTime: 60, targetPriorities: [{ ruleId: 'PR001', rulePriority: 1 }] },
}

/** `@` 路径插入状态桩：本组件只在"有会话上下文"时才渲染规则入口，故需要一个非空桩。 */
function makeMention(): PathInsertStore {
  return {
    open: ref(false),
    activeField: ref<string | null>(null),
    caret: ref(0),
    spaces: computed(() => []),
    column: ref('space'),
    activeSpace: ref<string | null>(null),
    activeDir: ref<string | null>(null),
    activeIndex: ref(0),
    dirs: computed(() => []),
    files: computed(() => []),
    loading: computed(() => false),
    handleInput: vi.fn(),
    pickSpace: vi.fn(),
    pickDir: vi.fn(),
    pickFile: vi.fn().mockReturnValue('数据准备/生产计划/plan.csv'),
    move: vi.fn(),
    confirmActive: vi.fn().mockReturnValue(null),
    back: vi.fn(),
    close: vi.fn(),
    reset: vi.fn(),
  } as unknown as PathInsertStore
}

interface FieldSetup {
  /** 整个入参 schema（本节点的 schema 由它按路径取出，保证与表单状态同源） */
  root: Record<string, unknown>
  path: NodePath
  proposed?: Record<string, unknown>
  rulesField?: string
  name?: string
  required?: boolean
  mention?: PathInsertStore | null
  fileIndex?: Map<string, { dir: string; file: WorkspaceFile }>
}

function mountField(setup: FieldSetup) {
  const loadRules = vi.fn<() => Promise<RuleFileResponse>>().mockResolvedValue(RULES)
  const form = createInteractionForm({
    schema: setup.root,
    proposed: setup.proposed ?? {},
    rulesField: setup.rulesField,
    loadRules,
  })
  const context: InteractionFormContext = {
    form,
    mention: setup.mention ?? null,
    fileIndex: setup.fileIndex ?? new Map(),
  }
  const wrapper = mount(InteractionField, {
    props: {
      schema: schemaAtPath(asSchema(setup.root), setup.path) ?? {},
      path: setup.path,
      name: setup.name ?? String(setup.path[setup.path.length - 1] ?? ''),
      required: setup.required ?? false,
    },
    global: { provide: { [INTERACTION_FORM_KEY as symbol]: context } },
  })
  return { wrapper, form }
}

describe('InteractionField —— 标量控件', () => {
  it('文本：预填值、required 标星、输入回写，并提示 @ 引用', async () => {
    const { wrapper, form } = mountField({
      root: { type: 'object', properties: { 产线: { type: 'string' } }, required: ['产线'] },
      path: ['产线'],
      proposed: { 产线: 'L01' },
      required: true,
    })

    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('L01')
    expect(wrapper.find('.interaction-dialog__label').classes()).toContain('required')
    // 说明性文案收进「?」：默认不展示（省版面），点开才看
    expect(wrapper.text()).not.toContain('输入 @ 可引用文件空间路径')
    await wrapper.find('.hint-tip__btn').trigger('click')
    expect(wrapper.find('.hint-tip__pop').text()).toContain('输入 @ 可引用文件空间路径')

    await wrapper.find('input[type=text]').setValue('L09')

    expect(form.valueOf(['产线'])).toBe('L09')
  })

  it('数字：输入回写为文本中间态，提交时才收敛为数字', async () => {
    const { wrapper, form } = mountField({
      root: { properties: { 数量: { type: 'integer' } } },
      path: ['数量'],
      proposed: { 数量: 3 },
    })

    await wrapper.find('input[type=number]').setValue('5')

    expect(form.valueOf(['数量'])).toBe('5')
    expect(form.build()).toEqual({ 数量: 5 })
  })

  it('开关与下拉：各自回写布尔与枚举值', async () => {
    const root = {
      properties: { 开关: { type: 'boolean' }, 类型: { type: 'string', enum: ['峰', '谷'] } },
    }
    const proposed = { 开关: true, 类型: '峰' }

    const onOff = mountField({ root, path: ['开关'], proposed })
    expect((onOff.wrapper.find('input[type=checkbox]').element as HTMLInputElement).checked).toBe(true)
    await onOff.wrapper.find('input[type=checkbox]').setValue(false)
    expect(onOff.form.valueOf(['开关'])).toBe(false)

    const choice = mountField({ root, path: ['类型'], proposed })
    expect((choice.wrapper.find('select').element as HTMLSelectElement).value).toBe('峰')
    await choice.wrapper.find('select').setValue('谷')
    expect(choice.form.valueOf(['类型'])).toBe('谷')
  })
})

describe('InteractionField —— 对象分组（递归）', () => {
  it('子字段逐个成行，required 取自本层；嵌套对象再往下展开', () => {
    const { wrapper } = mountField({
      root: NESTED,
      path: ['input'],
      name: 'input',
      required: true,
      proposed: NESTED_PROPOSED,
    })

    expect(wrapper.find('.interaction-dialog__group').exists()).toBe(true)
    const labels = wrapper.findAll('.interaction-dialog__label').map((item) => item.text())
    expect(labels[0]).toContain('input')
    expect(labels[1]).toContain('solvingTime')
    expect(labels[2]).toContain('targetPriorities')
    // required 来自 input 这一层（solvingTime 与 targetPriorities 都必填）
    expect(wrapper.findAll('.interaction-dialog__label')[1]!.classes()).toContain('required')
  })

  it('分组可切到 JSON 编辑，切回表单后子字段行回来', async () => {
    const { wrapper } = mountField({
      root: { properties: { input: { type: 'object', properties: { a: { type: 'string' } } } } },
      path: ['input'],
      name: 'input',
      proposed: { input: { a: 'v' } },
    })

    const toggle = wrapper
      .findAll('.interaction-dialog__tool-btn')
      .find((button) => button.text().includes('按 JSON 编辑'))!
    await toggle.trigger('click')

    expect(wrapper.find('.interaction-dialog__group').exists()).toBe(false)
    expect((wrapper.find('textarea.interaction-dialog__input--json').element as HTMLTextAreaElement).value).toBe(
      JSON.stringify({ a: 'v' }, null, 2),
    )
  })
})

describe('InteractionField —— 对象数组（表格）', () => {
  const root = {
    properties: {
      清单: {
        type: 'array',
        items: { type: 'object', properties: { ruleId: { type: 'string' } } },
      },
    },
  }

  it('列 = schema 声明列 + 值里实际出现的列；一行一个元素', () => {
    const { wrapper } = mountField({
      root,
      path: ['清单'],
      proposed: { 清单: [{ ruleId: 'PR001', 动态列: '来自数据' }] },
    })

    expect(wrapper.findAll('th').map((cell) => cell.text())).toEqual(['ruleId', '动态列', ''])
    expect(wrapper.findAll('tbody tr')).toHaveLength(1)
    expect((wrapper.find('tbody input[type=text]').element as HTMLInputElement).value).toBe('PR001')
  })

  it('加行/删行都写回模型（行下标不因渲染而错位）', async () => {
    const { wrapper, form } = mountField({
      root,
      path: ['清单'],
      proposed: { 清单: [{ ruleId: 'PR001' }] },
    })

    await wrapper
      .findAll('.interaction-dialog__tool-btn')
      .find((button) => button.text().includes('添加行'))!
      .trigger('click')
    expect(form.valueOf(['清单'])).toEqual([{ ruleId: 'PR001' }, {}])

    await wrapper.findAll('.interaction-dialog__row-remove')[0]!.trigger('click')
    expect(form.valueOf(['清单'])).toEqual([{}])
  })

  it('无可用的列时给出可操作提示，且「添加行」禁用', () => {
    const { wrapper } = mountField({
      root: { properties: { 清单: { type: 'array', items: { type: 'object' } } } },
      path: ['清单'],
      proposed: { 清单: [] },
    })

    expect(wrapper.find('.interaction-dialog__table-empty').text()).toContain('从算法规则选择')
    expect(
      wrapper
        .findAll('.interaction-dialog__tool-btn')
        .find((button) => button.text().includes('添加行'))!
        .attributes('disabled'),
    ).toBeDefined()
  })
})

describe('InteractionField —— 标量数组（列表）', () => {
  it('逐项渲染可编辑控件，支持加项/删项', async () => {
    const { wrapper, form } = mountField({
      root: { properties: { 天数: { type: 'array', items: { type: 'integer' } } } },
      path: ['天数'],
      proposed: { 天数: [1, 2] },
    })

    expect(wrapper.findAll('.interaction-dialog__list-row')).toHaveLength(2)
    expect((wrapper.findAll('input[type=number]')[1]!.element as HTMLInputElement).value).toBe('2')

    await wrapper.findAll('.interaction-dialog__row-remove')[1]!.trigger('click')
    expect(form.valueOf(['天数'])).toEqual([1])

    await wrapper
      .findAll('.interaction-dialog__tool-btn')
      .find((button) => button.text().includes('添加一项'))!
      .trigger('click')
    expect(form.valueOf(['天数'])).toEqual([1, ''])
  })
})

describe('InteractionField —— JSON 逃生舱', () => {
  it('自由对象（无 properties）渲染 JSON 文本框：非法文本不污染模型（不静默覆盖）', async () => {
    const { wrapper, form } = mountField({
      root: { properties: { 参数: { type: 'object' } } },
      path: ['参数'],
      proposed: { 参数: { a: 1 } },
    })

    const area = wrapper.find('textarea.interaction-dialog__input--json')
    expect(JSON.parse((area.element as HTMLTextAreaElement).value)).toEqual({ a: 1 })

    await area.setValue('{ 坏掉的')

    expect(form.valueOf(['参数'])).toEqual({ a: 1 })
  })
})

describe('InteractionField —— 算法规则入口落点', () => {
  function mountRulesField() {
    return mountField({
      root: NESTED,
      path: ['input', 'targetPriorities'],
      name: 'targetPriorities',
      proposed: NESTED_PROPOSED,
      rulesField: 'input.targetPriorities',
      mention: makeMention(),
    })
  }

  it('入口与它要影响的表格同属**一个字段块**（不再是"挂在祖先 JSON 框下面"）', () => {
    const { wrapper } = mountRulesField()

    const field = wrapper.find('.interaction-dialog__field')
    expect(wrapper.findAll('.interaction-dialog__rules-btn')).toHaveLength(1)
    expect(field.find('.interaction-dialog__rules-btn').exists()).toBe(true)
    expect(field.find('.interaction-dialog__table').exists()).toBe(true)
    // 完整目标路径写在按钮的无障碍名里（说明文案不再常驻一行）
    expect(field.find('.interaction-dialog__rules-btn').attributes('aria-label')).toContain(
      'input.targetPriorities',
    )
  })

  it('未声明 rules_field 时不渲染入口', () => {
    const { wrapper } = mountField({
      root: NESTED,
      path: ['input', 'targetPriorities'],
      name: 'targetPriorities',
      proposed: NESTED_PROPOSED,
      mention: makeMention(),
    })

    expect(wrapper.find('.interaction-dialog__rules-btn').exists()).toBe(false)
  })

  it('确认选择后把规则数组写回该字段（模型按路径深写）', async () => {
    const { wrapper, form } = mountRulesField()

    await wrapper.find('.interaction-dialog__rules-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.rule-picker__table').exists()).toBe(true)

    await wrapper.findAll('tbody input[type="checkbox"]')[0]!.setValue(true)
    await wrapper.findAll('button').find((button) => button.text().includes('确认选择'))!.trigger('click')

    expect(form.valueOf(['input', 'targetPriorities'])).toEqual([{ ruleId: 'PR001', rulePriority: 1 }])
  })
})

describe('InteractionField —— 文件卡片与上下文边界', () => {
  it('值命中文件空间 → 出结构化卡片，× 清除该字段', async () => {
    const { wrapper, form } = mountField({
      root: { properties: { 路径: { type: 'string' } } },
      path: ['路径'],
      proposed: { 路径: '数据准备/生产计划/plan.csv' },
      mention: makeMention(),
      fileIndex: new Map([
        ['数据准备/生产计划/plan.csv', { dir: '数据准备/生产计划', file: { filename: 'plan.csv', size: 2048, updated_at: '' } }],
      ]),
    })

    const card = wrapper.find('.interaction-dialog__file-card')
    expect(card.text()).toContain('plan.csv')
    expect(card.text()).toContain('2.0 KB')

    await card.find('.interaction-dialog__file-card-clear').trigger('click')

    expect(form.valueOf(['路径'])).toBe('')
    expect(wrapper.find('.interaction-dialog__file-card').exists()).toBe(false)
  })

  it('无上下文（未 provide）时不渲染：本组件只在弹窗 provider 内成立', () => {
    const wrapper = mount(InteractionField, {
      props: { schema: { type: 'string' }, path: ['x'], name: 'x' },
    })

    expect(wrapper.text()).toBe('')
  })
})
