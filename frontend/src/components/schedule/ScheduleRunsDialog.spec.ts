/**
 * 组件测试：运行记录弹窗（015，T056 / T065）
 *
 * 三类记录必须**一眼可分**：成功 / 失败 / 已跳过；其中"会话已删除"与 `skipped`（无会话）
 * 都不可点击，且文案不同——前者是"曾经有、现在没了"，后者是"本轮压根没建会话"。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { ScheduleRun } from '../../api/types'
import ScheduleRunsDialog from './ScheduleRunsDialog.vue'

function run(overrides: Partial<ScheduleRun> = {}): ScheduleRun {
  return {
    run_id: 'r1',
    task_id: 't1',
    task_name: '日报生成',
    triggered_at: '2026-10-30T01:00:00.000Z',
    finished_at: '2026-10-30T01:00:30.000Z',
    result: 'success',
    reason: null,
    reason_text: null,
    thread_id: 'th1',
    thread_title: '日报生成 2026-10-30 09:00:00',
    rebuilt: false,
    thread_deleted: false,
    ...overrides,
  }
}

describe('ScheduleRunsDialog', () => {
  it('三条记录：结果文案 + 会话名可点', () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: { open: true, runs: [run()], total: 1 },
    })

    expect(wrapper.text()).toContain('成功')
    expect(wrapper.text()).toContain('日报生成 2026-10-30 09:00:00')
    expect(wrapper.find('.runs__thread').exists()).toBe(true)
  })

  it('点击可跳转的记录 → open-thread', async () => {
    const wrapper = mount(ScheduleRunsDialog, { props: { open: true, runs: [run()] } })

    await wrapper.find('.runs__thread').trigger('click')

    expect(wrapper.emitted('open-thread')?.[0]).toEqual(['th1'])
  })

  it('会话已删除：明确文案 + 不可点（不发事件）', async () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: { open: true, runs: [run({ thread_deleted: true })] },
    })

    expect(wrapper.text()).toContain('会话已删除，不可打开')
    expect(wrapper.find('.runs__thread').exists()).toBe(false)
  })

  it('skipped：无会话，原因列说明为什么跳过', () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: {
        open: true,
        runs: [
          run({
            result: 'skipped',
            reason: 'busy_limit',
            reason_text: null,
            thread_id: null,
            thread_title: null,
          }),
        ],
      },
    })

    expect(wrapper.text()).toContain('已跳过')
    expect(wrapper.text()).toContain('并发额度已满')
    expect(wrapper.text()).toContain('未创建会话')
  })

  it('failed：显示原因摘要', () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: {
        open: true,
        runs: [run({ result: 'failed', reason: 'run_failed', reason_text: '模型返回失败' })],
      },
    })

    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('模型返回失败')
  })

  it('rebuilt=true → 标注"重建会话"', () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: { open: true, runs: [run({ rebuilt: true })] },
    })

    expect(wrapper.text()).toContain('重建会话')
  })

  it('空态：还没有执行记录', () => {
    const wrapper = mount(ScheduleRunsDialog, { props: { open: true, runs: [], total: 0 } })

    expect(wrapper.text()).toContain('还没有执行记录')
  })

  it('筛选：选具体任务发 task_id，选"全部任务"发 null', async () => {
    const wrapper = mount(ScheduleRunsDialog, {
      props: {
        open: true,
        runs: [run()],
        tasks: [
          {
            task_id: 't1',
            name: '日报生成',
          } as never,
        ],
      },
    })
    const select = wrapper.find('select')

    await select.setValue('t1')
    await select.setValue('')

    expect(wrapper.emitted('filter')).toEqual([['t1'], [null]])
  })

  it('加载中与失败态都有明确文案', async () => {
    const loading = mount(ScheduleRunsDialog, { props: { open: true, loading: true, runs: [] } })
    expect(loading.text()).toContain('正在加载运行记录')

    const failed = mount(ScheduleRunsDialog, {
      props: { open: true, error: { code: 'INTERNAL_ERROR', message: '坏了' } },
    })
    expect(failed.text()).toContain('运行记录加载失败')
  })
})
