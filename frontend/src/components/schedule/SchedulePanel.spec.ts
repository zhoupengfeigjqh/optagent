/**
 * 组件测试：设置覆盖层（015，T040 / T041a / T052）
 *
 * 三条关键口径：
 * 1. 头部按钮顺序固定「运行记录 → 创建定时任务 → ×」（FR-004）；
 * 2. **开合覆盖层不产生任何任务状态写入**（FR-003 / FR-006，T041a）——只看一眼设置
 *    不该触发 create / remove / toggle；
 * 3. 删除必须经过二次确认：确认框里带任务名，确认后才调 `removeTask`。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { ScheduledTask } from '../../api/types'
import ScheduleCreateDialog from './ScheduleCreateDialog.vue'
import SchedulePanel from './SchedulePanel.vue'
import ScheduleRunsDialog from './ScheduleRunsDialog.vue'
import ConfirmDialog from '../common/ConfirmDialog.vue'

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    task_id: 't1',
    name: '日报生成',
    prompt: '汇总进度',
    thinking: false,
    start_at: '2026-10-31T01:00:00.000Z',
    interval_seconds: 60,
    max_runs: 3,
    deadline_at: '2026-11-01T01:00:00.000Z',
    new_thread_per_run: true,
    enabled: false,
    executed_count: 0,
    status: 'idle',
    terminated: false,
    can_start: true,
    disabled_reason: null,
    next_run_at: '2026-10-31T01:00:00.000Z',
    last_run_at: null,
    agent_name: 'demo',
    created_at: '2026-10-30T00:00:00.000Z',
    updated_at: '2026-10-30T00:00:00.000Z',
    ...overrides,
  }
}

function mountPanel(props: Record<string, unknown> = {}) {
  const createTask = vi.fn(async () => true)
  const removeTask = vi.fn(async () => true)
  const wrapper = mount(SchedulePanel, {
    props: { open: true, tasks: [task()], createTask, removeTask, ...props },
  })
  return { wrapper, createTask, removeTask }
}

describe('SchedulePanel', () => {
  it('头部按钮顺序：运行记录 → 创建定时任务 → 关闭（并带无障碍名称）', () => {
    const { wrapper } = mountPanel()
    const headerButtons = wrapper.findAll('.schedule-panel__actions button')

    expect(headerButtons).toHaveLength(3)
    expect(headerButtons[0]!.text()).toBe('运行记录')
    expect(headerButtons[1]!.text()).toBe('创建定时任务')
    expect(headerButtons[2]!.attributes('aria-label')).toBe('关闭定时任务设置')
  })

  it('覆盖层有可读标题（aria-labelledby 指向 h2）', () => {
    const { wrapper } = mountPanel()
    const dialog = wrapper.find('dialog')

    const labelId = dialog.attributes('aria-labelledby')
    expect(labelId).toBe('schedule-panel-title')
    expect(wrapper.find(`#${labelId}`).text()).toBe('定时任务')
  })

  it('打开 / 关闭覆盖层不写入任何任务状态（T041a）', async () => {
    const { wrapper, createTask, removeTask } = mountPanel()

    await wrapper.find('.schedule-panel__close').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(createTask).not.toHaveBeenCalled()
    expect(removeTask).not.toHaveBeenCalled()
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('点「运行记录」→ 打开弹窗并按当前筛选拉取', async () => {
    const { wrapper } = mountPanel()

    await wrapper.findAll('.schedule-panel__actions button')[0]!.trigger('click')

    expect(wrapper.emitted('load-runs')?.[0]).toEqual([null])
    expect(wrapper.findComponent(ScheduleRunsDialog).props('open')).toBe(true)
  })

  it('覆盖层被外部关闭（如点运行记录跳转会话）→ 子弹窗一并收起，不留顶层模态', async () => {
    const { wrapper } = mountPanel()
    await wrapper.findAll('.schedule-panel__actions button')[0]!.trigger('click')
    expect(wrapper.findComponent(ScheduleRunsDialog).props('open')).toBe(true)

    // 父级直接改 `open`（跳转会话的关闭路径），组件自身的 closePanel 不会执行
    await wrapper.setProps({ open: false })

    // 留在打开态的模态会让整个文档 inert —— 回到聊天区后哪里都点不动
    expect(wrapper.findComponent(ScheduleRunsDialog).props('open')).toBe(false)
  })

  it('点「创建定时任务」→ 打开创建弹窗；创建成功才收起', async () => {
    const { wrapper, createTask } = mountPanel()

    await wrapper.findAll('.schedule-panel__actions button')[1]!.trigger('click')
    const createDialog = wrapper.findComponent(ScheduleCreateDialog)
    expect(createDialog.props('open')).toBe(true)

    createDialog.vm.$emit('submit', { name: 'x' })
    await vi.waitFor(() => expect(createTask).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(wrapper.findComponent(ScheduleCreateDialog).props('open')).toBe(false))
  })

  it('创建失败 → 弹窗保持打开（保住已填内容）', async () => {
    const { wrapper } = mountPanel({ createTask: vi.fn(async () => false) })

    await wrapper.findAll('.schedule-panel__actions button')[1]!.trigger('click')
    wrapper.findComponent(ScheduleCreateDialog).vm.$emit('submit', { name: 'x' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(wrapper.findComponent(ScheduleCreateDialog).props('open')).toBe(true)
  })

  it('停用行点编辑 → 打开同一个表单弹窗并带上该任务（预填来源）', async () => {
    const { wrapper } = mountPanel()
    // 行内按钮顺序：启停(0) → 编辑(1) → 删除(2)
    await wrapper.findAll('tbody button')[1]!.trigger('click')

    const dialog = wrapper.findComponent(ScheduleCreateDialog)
    expect(dialog.props('open')).toBe(true)
    expect(dialog.props('task')).toMatchObject({ task_id: 't1', name: '日报生成' })
  })

  it('编辑成功才收起表单；失败保留（与会话创建同口径）', async () => {
    const updateTask = vi.fn(async (_taskId: string, _input: Record<string, unknown>) => true)
    const { wrapper } = mountPanel({ updateTask })

    await wrapper.findAll('tbody button')[1]!.trigger('click')
    wrapper.findComponent(ScheduleCreateDialog).vm.$emit('submit', { name: '改后的名字' })
    await vi.waitFor(() => expect(updateTask).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(wrapper.findComponent(ScheduleCreateDialog).props('open')).toBe(false),
    )

    // 编辑只提交 7 项可编辑字段：会话模式不进 PATCH 体（服务端会按未声明字段 400）
    const [, payload] = updateTask.mock.calls[0]!
    expect(payload).not.toHaveProperty('new_thread_per_run')
  })

  it('删除要经过二次确认：文案含任务名，确认后才调用 removeTask', async () => {
    const { wrapper, removeTask } = mountPanel()
    // 行内删除按钮（第 3 个）→ 弹确认框
    await wrapper.findAll('tbody button')[2]!.trigger('click')

    const confirm = wrapper.findComponent(ConfirmDialog)
    expect(confirm.props('open')).toBe(true)
    expect(String(confirm.props('message'))).toContain('日报生成')
    expect(removeTask).not.toHaveBeenCalled()

    confirm.vm.$emit('confirm')
    await vi.waitFor(() => expect(removeTask).toHaveBeenCalledWith('t1'))
    expect(wrapper.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  it('取消确认 → 不发删除请求', async () => {
    const { wrapper, removeTask } = mountPanel()

    await wrapper.findAll('tbody button')[2]!.trigger('click')
    wrapper.findComponent(ConfirmDialog).vm.$emit('cancel')
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(removeTask).not.toHaveBeenCalled()
    expect(wrapper.findComponent(ConfirmDialog).props('open')).toBe(false)
  })

  it('启停：行内按钮直接上抛 toggle（不做二次确认，可立即回退）', async () => {
    const { wrapper } = mountPanel()

    await wrapper.findAll('tbody button')[0]!.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual([{ taskId: 't1', enabled: true }])
  })

  it('信号降级时提示"实时更新已暂停"并给手动刷新入口', async () => {
    const { wrapper } = mountPanel({ degraded: true })

    expect(wrapper.text()).toContain('实时更新已暂停')
    await wrapper.find('.schedule-panel__link').trigger('click')
    expect(wrapper.emitted('reload')).toHaveLength(1)
  })

  it('Esc（原生 cancel）收敛为 close，不自己改 open', async () => {
    const { wrapper } = mountPanel()

    await wrapper.find('dialog').trigger('cancel')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
