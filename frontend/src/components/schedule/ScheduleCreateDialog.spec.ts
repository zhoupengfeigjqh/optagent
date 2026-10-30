/**
 * 组件测试：创建定时任务弹窗（015，T039 / T064）
 *
 * 验收项：
 * - 8 项输入的默认值（尤其"每次任务创建新对话"**默认勾选**、思考开关来自 props）；
 * - 字段级校验：文案与后端 `data-model.md` §6 同一套，错误经 `aria-describedby` 关联；
 * - 提交成功才发 `submit`，失败（校验不过）一个请求都不发；`submitting` 时全部禁用。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ScheduleCreateDialog from './ScheduleCreateDialog.vue'

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ScheduleCreateDialog, { props: { open: true, ...props } })
}

/** 填一份合法表单（时间用未来时刻，避免与真实时钟赛跑） */
async function fillValid(wrapper: ReturnType<typeof mountDialog>): Promise<void> {
  const future = new Date(Date.now() + 3600_000)
  const later = new Date(Date.now() + 86_400_000)
  const local = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
      date.getDate(),
    ).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(
      date.getMinutes(),
    ).padStart(2, '0')}`

  await wrapper.find('input[type="text"]').setValue('日报生成')
  await wrapper.find('textarea').setValue('汇总今天的进度')
  const datetimeInputs = wrapper.findAll('input[type="datetime-local"]')
  await datetimeInputs[0]!.setValue(local(future))
  await datetimeInputs[1]!.setValue(local(later))
}

describe('ScheduleCreateDialog', () => {
  it('默认值：会话模式默认勾选、思考开关取 props、间隔 60、次数 10', () => {
    const wrapper = mountDialog({ defaultThinking: true })

    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    // 顺序：思考开关 → 每次任务创建新对话
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true)
    expect((checkboxes[1]!.element as HTMLInputElement).checked).toBe(true)

    const numbers = wrapper.findAll('input[type="number"]')
    expect((numbers[0]!.element as HTMLInputElement).value).toBe('60')
    expect((numbers[1]!.element as HTMLInputElement).value).toBe('10')
  })

  it('未勾选会话模式 → 提交体带 new_thread_per_run=false 与 ISO 时间', async () => {
    const wrapper = mountDialog()
    await fillValid(wrapper)
    await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(false)

    await wrapper.find('.schedule-form__button--primary').trigger('click')

    const payload = wrapper.emitted('submit')?.[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      name: '日报生成',
      prompt: '汇总今天的进度',
      interval_seconds: 60,
      max_runs: 10,
      new_thread_per_run: false,
    })
    expect(String(payload.start_at)).toMatch(/Z$/)
  })

  it('名称为空 → 报错且不发 submit；错误与输入框通过 aria-describedby 关联', async () => {
    const wrapper = mountDialog()
    await fillValid(wrapper)
    await wrapper.find('input[type="text"]').setValue('   ')

    await wrapper.find('.schedule-form__button--primary').trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('请填写任务名称')
    const input = wrapper.find('input[type="text"]')
    expect(input.attributes('aria-invalid')).toBe('true')
    const describedBy = input.attributes('aria-describedby')
    expect(wrapper.find(`#${describedBy}`).text()).toContain('请填写任务名称')
  })

  it('截止时间不晚于开始时间 → 报错', async () => {
    const wrapper = mountDialog()
    await fillValid(wrapper)
    const datetimeInputs = wrapper.findAll('input[type="datetime-local"]')
    await datetimeInputs[1]!.setValue((datetimeInputs[0]!.element as HTMLInputElement).value)

    await wrapper.find('.schedule-form__button--primary').trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('有效截止时间必须晚于开始时间')
  })

  it('间隔 / 次数非正整数 → 报错', async () => {
    const wrapper = mountDialog()
    await fillValid(wrapper)
    await wrapper.findAll('input[type="number"]')[0]!.setValue('1.5')

    await wrapper.find('.schedule-form__button--primary').trigger('click')

    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('执行频率必须是不小于 1 的整数秒')
  })

  it('submitting：按钮禁用、文案改为"创建中…"，已填内容保留', async () => {
    const wrapper = mountDialog()
    await fillValid(wrapper)
    await wrapper.setProps({ submitting: true })

    const primary = wrapper.find('.schedule-form__button--primary')
    expect((primary.element as HTMLButtonElement).disabled).toBe(true)
    expect(primary.text()).toBe('创建中…')
    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('日报生成')
  })

  it('关闭按钮只发 close，不发 submit', async () => {
    const wrapper = mountDialog()

    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})

/**
 * 编辑模式（2026-10-30 增补）：同一个组件、同一套校验，只有三处差别——
 * 标题/主按钮文案、表单预填、会话模式只读（`FR-060`），以及允许开始时间已过去。
 */
describe('ScheduleCreateDialog —— 编辑模式', () => {
  const task = {
    task_id: 't1',
    name: '日报生成',
    prompt: '汇总今天的进度',
    thinking: true,
    start_at: new Date(Date.now() - 3_600_000).toISOString(),
    interval_seconds: 3600,
    max_runs: 5,
    deadline_at: new Date(Date.now() + 86_400_000).toISOString(),
    new_thread_per_run: false,
    enabled: false,
    executed_count: 2,
    status: 'idle' as const,
    terminated: false,
    can_start: true,
    disabled_reason: null,
    next_run_at: null,
    last_run_at: null,
    agent_name: 'demo',
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
  }

  it('标题与主按钮改为编辑语义；表单预填现有配置', () => {
    const wrapper = mountDialog({ task })

    expect(wrapper.find('.base-dialog__title').text()).toBe('编辑定时任务')
    expect(wrapper.find('.schedule-form__button--primary').text()).toBe('保存')

    expect((wrapper.find('input[type="text"]').element as HTMLInputElement).value).toBe('日报生成')
    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('汇总今天的进度')

    const numbers = wrapper.findAll('input[type="number"]')
    expect((numbers[0]!.element as HTMLInputElement).value).toBe('3600')
    expect((numbers[1]!.element as HTMLInputElement).value).toBe('5')
  })

  it('会话模式只读：复选框回显原值且禁用（`FR-060`）', () => {
    const wrapper = mountDialog({ task })
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    const newThread = checkboxes[1]!

    expect((newThread.element as HTMLInputElement).checked).toBe(false)
    expect((newThread.element as HTMLInputElement).disabled).toBe(true)
    expect(wrapper.text()).toContain('会话模式在创建后不可修改')
  })

  it('允许保留已过去的开始时间（只改名字不被挡住），提交体与创建同形状', async () => {
    const wrapper = mountDialog({ task })

    await wrapper.find('input[type="text"]').setValue('改后的名字')
    await wrapper.find('.schedule-form__button--primary').trigger('click')

    const payload = wrapper.emitted('submit')?.[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({
      name: '改后的名字',
      prompt: '汇总今天的进度',
      thinking: true,
      interval_seconds: 3600,
      max_runs: 5,
    })
    // 开始时间原样保留（不因为"已过去"而报错，也不被静默改写）。
    // 表单精度是分钟（`datetime-local`），故比较到分钟：秒/毫秒按表单能力截断。
    const submitted = new Date(String(payload.start_at))
    const original = new Date(task.start_at)
    expect(submitted.getTime()).toBe(
      original.getTime() - (original.getSeconds() * 1000 + original.getMilliseconds()),
    )
  })

  it('编辑态提交中文案为"保存中…"', async () => {
    const wrapper = mountDialog({ task, submitting: true })

    const primary = wrapper.find('.schedule-form__button--primary')
    expect(primary.text()).toBe('保存中…')
    expect((primary.element as HTMLButtonElement).disabled).toBe(true)
  })
})
