/**
 * 组件测试：任务表格（015，T038）
 *
 * 读屏验收项：`<table>` + `scope="col"` 的列头 + `caption` 表格名，三者缺一读屏就
 * 只能念出一串数字。另有两条状态机：空态给创建引导、失败态给重试（都不冒充"没有任务"）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ScheduledTask } from '../../api/types'
import ScheduleTable from './ScheduleTable.vue'

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

describe('ScheduleTable', () => {
  it('表头 6 列均为 scope="col"，并有可读的表格名', () => {
    const wrapper = mount(ScheduleTable, { props: { tasks: [task()] } })
    const headers = wrapper.findAll('th')

    expect(headers).toHaveLength(6)
    for (const header of headers) {
      expect(header.attributes('scope')).toBe('col')
    }
    expect(wrapper.find('caption').text()).toBe('定时任务列表')
  })

  it('按 task_id 渲染行（稳定的 key，切数据不串行）', async () => {
    const wrapper = mount(ScheduleTable, {
      props: { tasks: [task({ task_id: 'a', name: '任务A' }), task({ task_id: 'b', name: '任务B' })] },
    })

    expect(wrapper.findAll('tbody tr')).toHaveLength(2)

    await wrapper.setProps({ tasks: [task({ task_id: 'b', name: '任务B' })] })

    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.text()).toContain('任务B')
  })

  it('任意行的启停/编辑/删除事件原样上抛（顺序：启停 → 编辑 → 删除）', async () => {
    const wrapper = mount(ScheduleTable, { props: { tasks: [task()] } })
    const buttons = wrapper.findAll('tbody button')

    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual([{ taskId: 't1', enabled: true }])
    expect(wrapper.emitted('edit')?.[0]).toEqual(['t1'])
    expect(wrapper.emitted('remove')?.[0]).toEqual(['t1'])
  })

  it('空态：文案 + 创建引导（不是一句"暂无数据"）', async () => {
    const wrapper = mount(ScheduleTable, { props: { tasks: [] } })

    expect(wrapper.text()).toContain('还没有定时任务')
    await wrapper.find('.schedule-table__create').trigger('click')
    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('错误态：给出原因与重试，且不渲染表格', async () => {
    const wrapper = mount(ScheduleTable, {
      props: { tasks: [], error: { code: 'INTERNAL_ERROR', message: '数据损坏' } },
    })

    expect(wrapper.text()).toContain('任务加载失败')
    expect(wrapper.text()).toContain('数据损坏')
    expect(wrapper.find('table').exists()).toBe(false)

    await wrapper.find('.schedule-table__link').trigger('click')
    expect(wrapper.emitted('reload')).toHaveLength(1)
  })

  it('加载中且无数据 → 明确的加载提示（不留白）', () => {
    const wrapper = mount(ScheduleTable, { props: { tasks: [], loading: true } })

    expect(wrapper.find('[role="status"]').text()).toContain('正在加载任务')
  })
})
