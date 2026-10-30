/**
 * 组件测试：任务行（015，T037 / T051；2026-10-30 增补编辑按钮与"启用中只有停止可用"）
 *
 * 键盘与读屏验收项：
 * - 三个按钮都是原生 `<button>`，DOM 顺序 = Tab 顺序（启停 → 编辑 → 删除）；
 * - 启停按钮 `aria-pressed` 表达开/关，名称里带任务名；启用态用**方块**形状而非三角；
 * - 启用中编辑与删除原生禁用，原因在 `title` 上；处理函数仍兜一层可见提示；
 * - 停用态点编辑上抛 `edit`，点删除上抛 `remove`。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ScheduledTask } from '../../api/types'
import ScheduleRow from './ScheduleRow.vue'

function task(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    task_id: 't1',
    name: '日报生成',
    prompt: '汇总进度',
    thinking: false,
    start_at: '2026-10-31T01:00:00.000Z',
    interval_seconds: 3600,
    max_runs: 5,
    deadline_at: '2026-11-07T01:00:00.000Z',
    new_thread_per_run: true,
    enabled: false,
    executed_count: 2,
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

describe('ScheduleRow', () => {
  it('六列内容齐全（名称 / 状态 / 频率 / 次数 / 下次触发 / 操作）', () => {
    const wrapper = mount(ScheduleRow, { props: { task: task() }, global: {} })
    const cells = wrapper.findAll('td')

    expect(cells).toHaveLength(6)
    expect(cells[0]!.text()).toContain('日报生成')
    expect(cells[1]!.text()).toContain('未开始')
    expect(cells[2]!.text()).toBe('每 1 小时')
    expect(cells[3]!.text()).toBe('已执行 2 / 5 次')
    expect(cells[4]!.text()).toMatch(/^下次 /)
  })

  it('三个按钮顺序：启停 → 编辑 → 删除（原生 button，无 tabindex 干预）', () => {
    const wrapper = mount(ScheduleRow, { props: { task: task() } })
    const buttons = wrapper.findAll('button')

    expect(buttons.map((button) => button.element.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON'])
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false')
    expect(buttons[0]!.attributes('aria-label')).toBe('启动任务：日报生成')
    expect(buttons[1]!.attributes('aria-label')).toBe('编辑任务：日报生成')
    expect(buttons[2]!.attributes('aria-label')).toBe('删除任务：日报生成')
    expect(buttons[0]!.element.getAttribute('tabindex')).toBeNull()
  })

  it('点击启停 → toggle{taskId, enabled=true}', async () => {
    const wrapper = mount(ScheduleRow, { props: { task: task() } })

    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual([{ taskId: 't1', enabled: true }])
  })

  it('停用态点编辑 → 上抛 edit（编辑也走行内入口）', async () => {
    const wrapper = mount(ScheduleRow, { props: { task: task() } })

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('edit')?.[0]).toEqual(['t1'])
  })

  it('启用中 → 启停显示"停止"且用红色方块（不是三角），aria-pressed=true', async () => {
    const wrapper = mount(ScheduleRow, {
      props: { task: task({ enabled: true, status: 'running' }) },
    })
    const toggle = wrapper.findAll('button')[0]!

    expect(toggle.attributes('aria-pressed')).toBe('true')
    expect(toggle.attributes('aria-label')).toBe('停止任务：日报生成')
    // 形状本身区分两态：启用态是方块，停用态是三角（图标）
    expect(toggle.find('.schedule-row__stop-square').exists()).toBe(true)
    expect(toggle.find('.base-icon').exists()).toBe(false)
    expect(toggle.classes()).toContain('schedule-row__action--stop')

    await toggle.trigger('click')
    expect(wrapper.emitted('toggle')?.[0]).toEqual([{ taskId: 't1', enabled: false }])
  })

  it('已结束的任务：启停按钮原生禁用，原因在 title 上', () => {
    const wrapper = mount(ScheduleRow, {
      props: { task: task({ terminated: true, can_start: false }) },
    })
    const toggle = wrapper.findAll('button')[0]!

    expect((toggle.element as HTMLButtonElement).disabled).toBe(true)
    expect(toggle.attributes('title')).toContain('已用尽执行次数')
  })

  it('启用中只有停止可用：编辑与删除原生禁用，原因在 title 上', () => {
    const wrapper = mount(ScheduleRow, { props: { task: task({ enabled: true }) } })
    const buttons = wrapper.findAll('button')

    expect((buttons[1]!.element as HTMLButtonElement).disabled).toBe(true)
    expect((buttons[2]!.element as HTMLButtonElement).disabled).toBe(true)
    expect(buttons[1]!.attributes('title')).toBe('请先停止任务')
    expect(buttons[2]!.attributes('title')).toBe('请先停止任务')
  })

  it('启用中即使触发点击也不会发出删除 / 编辑请求（处理函数兜底）', async () => {
    const wrapper = mount(ScheduleRow, { props: { task: task({ enabled: true }) } })

    await wrapper.findAll('button')[2]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('remove')).toBeUndefined()
    expect(wrapper.emitted('edit')).toBeUndefined()
  })

  it('停用的任务点删除 → 发 remove', async () => {
    const wrapper = mount(ScheduleRow, { props: { task: task() } })

    await wrapper.findAll('button')[2]!.trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual(['t1'])
  })

  it('busy：三个按钮都禁用（请求在途时不能重复点）', () => {
    const wrapper = mount(ScheduleRow, { props: { task: task(), busy: true } })

    for (const button of wrapper.findAll('button')) {
      expect((button.element as HTMLButtonElement).disabled).toBe(true)
    }
  })
})
