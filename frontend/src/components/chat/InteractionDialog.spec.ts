import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import type { InteractionSnapshot } from '../../api/types'
import { APP_SESSION_KEY, type AppSession } from '../../composables/useAppSession'
import type { WorkspaceStore } from '../../composables/useWorkspace'
import InteractionDialog from './InteractionDialog.vue'

function makeRequest(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
  return {
    interaction_id: 'i_abc',
    call_id: 'c1',
    tool_name: 'some__tool',
    title: '确认调用参数：some__tool',
    schema: {
      type: 'object',
      properties: {
        产线: { type: 'string', description: '产线编号' },
        数量: { type: 'integer' },
        类型: { type: 'string', enum: ['峰', '谷'] },
        备注: { type: 'string', description: '多行备注' },
      },
      required: ['产线', '数量'],
    },
    proposed_args: { 产线: 'L01', 数量: 3, 类型: '峰' },
    required: ['产线', '数量'],
    timeout_seconds: 300,
    remaining_seconds: 300,
    ...overrides,
  }
}

function mountDialog(request: InteractionSnapshot = makeRequest()) {
  return mount(InteractionDialog, { props: { request } })
}

describe('InteractionDialog —— 标题行（2026-10-27）', () => {
  it('工具名只由标题承载；倒计时贴标题右侧，正文不再有工具名行与说明入口', () => {
    const wrapper = mountDialog(
      makeRequest({
        tool_label: '识别图片文字',
        title: '确认调用参数：识别图片文字',
        tool_description: '识别图片中的文字，返回按行拼接的文本',
      }),
    )

    expect(wrapper.find('.base-dialog__title').text()).toBe('确认调用参数：识别图片文字')

    // 倒计时在**头部**（标题右边），不再单独占正文一行；它仍是超时可见性的唯一来源
    const header = wrapper.find('.base-dialog__header')
    expect(header.find('.interaction-dialog__countdown').text()).toContain('剩余')
    expect(wrapper.find('.interaction-dialog__meta').exists()).toBe(false)

    expect(wrapper.find('[aria-label="查看工具说明"]').exists()).toBe(false)
    expect(wrapper.find('.interaction-dialog__tool').exists()).toBe(false)
  })
})

describe('InteractionDialog —— Schema 驱动表单', () => {
  it('按 schema 渲染控件：select/switch/number/textarea，并预填 proposed_args', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('select').exists()).toBe(true)
    expect((wrapper.find('select').element as HTMLSelectElement).value).toBe('0')
    expect(wrapper.findAll('option')[1]!.text()).toBe('峰')
    expect(wrapper.find('input[type=number]').exists()).toBe(true)
    expect((wrapper.find('input[type=number]').element as HTMLInputElement).value).toBe('3')
    expect(wrapper.find('input[type=text]').exists()).toBe(true)
    expect((wrapper.find('input[type=text]').element as HTMLInputElement).value).toBe('L01')
    expect(wrapper.find('textarea').exists()).toBe(true)

    const labels = wrapper.findAll('.interaction-dialog__label')
    expect(labels[0]!.classes()).toContain('required')
    expect(labels[2]!.classes()).not.toContain('required')
  })

  it('提交：携带修改后的参数，跳过未填的可选项', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type=text]').setValue('L09')
    await wrapper.find('input[type=number]').setValue('5')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')

    const events = wrapper.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events![0]!).toEqual([{ 产线: 'L09', 数量: 5, 类型: '峰' }])
  })

  it('本地校验：必填缺失不 emit 并提示', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type=text]').setValue('')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('产线')
  })

  it('数字控件：清空后被本地校验拦下，不 emit', async () => {
    const wrapper = mountDialog()
    await wrapper.find('input[type=number]').setValue('')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('数量')
  })

  it('JSON 逃生舱：schema 表达不了的形状以 JSON 文本编辑，解析失败不 emit', async () => {
    const request = makeRequest({
      schema: {
        type: 'object',
        properties: {
          产线: { type: 'string' },
          矩阵: { type: 'array', items: { type: 'array', items: { type: 'integer' } } },
        },
        required: ['产线'],
      },
      proposed_args: { 产线: 'L01', 矩阵: [[1, 2]] },
    })
    const wrapper = mountDialog(request)

    const area = wrapper.find('textarea.interaction-dialog__input--json')
    expect(JSON.parse((area.element as HTMLTextAreaElement).value)).toEqual([[1, 2]])

    await area.setValue('{bad json')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.find('.interaction-dialog__error').text()).toContain('矩阵')
  })

  it('拒绝按钮 emit reject', async () => {
    const wrapper = mountDialog()

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '拒绝调用')!
      .trigger('click')

    expect(wrapper.emitted('reject')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('服务端终验错误展示（serverError prop）', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ serverError: '参数「数量」须为整数' })

    expect(wrapper.find('.interaction-dialog__error').text()).toContain('须为整数')
  })

  it('嵌套入参：顶层对象展开成子字段行，而不是一整块 JSON', () => {
    const wrapper = mountDialog(
      makeRequest({
        schema: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              properties: { solvingTime: { type: 'integer' }, days: { type: 'integer' } },
              required: ['solvingTime'],
            },
          },
          required: ['input'],
        },
        proposed_args: { input: { solvingTime: 60, days: 7 } },
        required: ['input'],
      }),
    )

    const labels = wrapper.findAll('.interaction-dialog__label').map((item) => item.text())
    expect(labels[0]).toContain('input')
    expect(labels[1]).toContain('solvingTime')
    expect(labels[2]).toContain('days')
    expect(wrapper.findAll('input[type=number]')).toHaveLength(2)
    expect(wrapper.find('textarea.interaction-dialog__input--json').exists()).toBe(false)
  })

  it('无参数工具：展示确认提示，提交空对象', async () => {
    const wrapper = mountDialog(
      makeRequest({ schema: { type: 'object', properties: {} }, proposed_args: {}, required: [] }),
    )

    expect(wrapper.find('.interaction-dialog__empty').exists()).toBe(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')
    expect(wrapper.emitted('submit')).toEqual([[{}]])
  })
})

describe('InteractionDialog —— 倒计时', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('倒计时归零自动按拒绝处理', async () => {
    const wrapper = mountDialog(makeRequest({ remaining_seconds: 2 }))

    await vi.advanceTimersByTimeAsync(2000)

    expect(wrapper.emitted('reject')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})

describe('InteractionDialog —— 算法规则选择（rules_field 装配）', () => {
  const RULES_RESPONSE = {
    filename: 'rules_20260919.xlsx',
    updated_at: '2026-09-19T08:00:00.000Z',
    columns: ['规则编码', '规则名称', '优先级'],
    rows: [
      { 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 },
      { 规则编码: 'R002', 规则名称: '需量控制', 优先级: 1 },
    ],
    priority_column: '优先级',
  }

  function makeRulesRequest(overrides: Partial<InteractionSnapshot> = {}): InteractionSnapshot {
    return makeRequest({
      schema: {
        type: 'object',
        properties: {
          rules: { type: 'array', items: { type: 'object' }, description: '算法规则清单' },
          days: { type: 'integer' },
        },
      },
      proposed_args: { days: 7 },
      required: [],
      rules_field: 'rules',
      ...overrides,
    })
  }

  function mountRulesDialog(request: InteractionSnapshot = makeRulesRequest()) {
    const workspace = {
      spaces: ref([]),
      dirs: ref([]),
      loading: ref(false),
      load: vi.fn().mockResolvedValue(undefined),
      filesOf: vi.fn().mockReturnValue([]),
    } as unknown as WorkspaceStore
    const files = { rules: vi.fn().mockResolvedValue(RULES_RESPONSE) }
    const session = { workspace, files } as unknown as AppSession
    const wrapper = mount(InteractionDialog, {
      props: { request },
      global: { provide: { [APP_SESSION_KEY as symbol]: session } },
    })
    return { wrapper, files }
  }

  it('snapshot 声明 rules_field：目标字段出现「从算法规则选择」入口；未声明不出现', () => {
    const declared = mountRulesDialog()
    expect(declared.wrapper.find('.interaction-dialog__rules-btn').exists()).toBe(true)

    const plain = mountDialog(makeRequest())
    expect(plain.find('.interaction-dialog__rules-btn').exists()).toBe(false)
  })

  it('勾选规则确认后：数组写进该参数，提交携带它', async () => {
    const { wrapper } = mountRulesDialog()
    await flushPromises()

    await wrapper.find('.interaction-dialog__rules-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('.rule-picker__table').exists()).toBe(true)

    await wrapper.findAll('tbody input[type="checkbox"]')[0]!.setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('确认选择'))!
      .trigger('click')

    expect(wrapper.findAll('th').map((cell) => cell.text())).toContain('规则编码')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')
    const events = wrapper.emitted('submit')
    expect(events).toHaveLength(1)
    expect(events![0]!).toEqual([
      { days: 7, rules: [{ 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 }] },
    ])
  })

  it('弹窗取消不影响参数值', async () => {
    const { wrapper } = mountRulesDialog()
    await flushPromises()

    await wrapper.find('.interaction-dialog__rules-btn').trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '取消')!
      .trigger('click')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')
    expect(wrapper.emitted('submit')![0]!).toEqual([{ days: 7 }])
  })

  it('rules_field 为对象路径：入口落在目标那一行，勾选后深写进该字段', async () => {
    const { wrapper } = mountRulesDialog(
      makeRulesRequest({
        schema: {
          type: 'object',
          properties: {
            input: {
              type: 'object',
              description: '排产输入配置',
              properties: {
                solvingTime: { type: 'integer' },
                targetPriorities: {
                  type: 'array',
                  items: { type: 'object', properties: { ruleId: { type: 'string' } } },
                },
              },
            },
          },
        },
        proposed_args: { input: { solvingTime: 60 } },
        required: ['input'],
        rules_field: 'input.targetPriorities',
      }),
    )
    await flushPromises()

    const fields = wrapper.findAll('.interaction-dialog__field')
    const target = fields.find((field) => field.find('.interaction-dialog__rules-btn').exists())!
    expect(target.find('.interaction-dialog__table').exists()).toBe(true)
    expect(wrapper.findAll('.interaction-dialog__rules-btn')).toHaveLength(1)
    expect(target.find('.interaction-dialog__rules-btn').attributes('aria-label')).toContain(
      'input.targetPriorities',
    )

    await target.find('.interaction-dialog__rules-btn').trigger('click')
    await flushPromises()
    await wrapper.findAll('tbody input[type="checkbox"]')[0]!.setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('确认选择'))!
      .trigger('click')

    await wrapper
      .findAll('button')
      .find((b) => b.text() === '确认提交')!
      .trigger('click')
    expect(wrapper.emitted('submit')![0]!).toEqual([
      {
        input: {
          solvingTime: 60,
          targetPriorities: [{ 规则编码: 'R001', 规则名称: '峰谷平移', 优先级: 3 }],
        },
      },
    ])
  })

  it('对象路径 + 目标祖先处于 JSON 编辑且文本非法：只报错、不覆盖（模型与文本都不变）', async () => {
    const { wrapper } = mountRulesDialog(
      makeRulesRequest({
        schema: { type: 'object', properties: { input: { type: 'object' } } },
        proposed_args: {},
        required: [],
        rules_field: 'input.targetPriorities',
      }),
    )
    await flushPromises()

    await wrapper.find('textarea').setValue('{ 坏掉的 ')
    await wrapper.find('.interaction-dialog__rules-btn').trigger('click')
    await flushPromises()
    await wrapper.findAll('tbody input[type="checkbox"]')[0]!.setValue(true)
    await wrapper
      .findAll('button')
      .find((b) => b.text().includes('确认选择'))!
      .trigger('click')

    expect(wrapper.text()).toContain('不是合法 JSON')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('{ 坏掉的 ')
  })
})
