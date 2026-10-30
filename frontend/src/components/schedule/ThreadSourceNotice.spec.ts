/**
 * 组件测试：会话来源提示（015，T043）
 *
 * 读屏验收项：`role="status"`（礼貌级）在进入会话时播报一次；文案必须包含
 * **任务名**与**触发时刻**——否则用户只知道"这是自动跑的"，不知道是哪条任务。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ThreadSourceNotice from './ThreadSourceNotice.vue'

describe('ThreadSourceNotice', () => {
  it('文案含任务名与触发时刻；role=status（礼貌播报，不打断回答）', () => {
    const wrapper = mount(ThreadSourceNotice, {
      props: {
        source: {
          type: 'scheduled_task',
          task_id: 't1',
          task_name: '日报生成',
          triggered_at: '2026-10-30T01:02:03.000Z',
        },
      },
    })

    expect(wrapper.text()).toContain('由定时任务「日报生成」于')
    expect(wrapper.text()).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-live')).toBeUndefined()
  })
})
