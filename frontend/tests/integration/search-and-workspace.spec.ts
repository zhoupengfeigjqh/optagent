/**
 * US8 集成验收：会话内容搜索与工作空间文件
 *
 * 覆盖 quickstart 的 US8 独立测试路径：
 * 输入关键词 → 黄色高亮 + 首次定位 → 「下一个」逐次跳转 → 到末尾循环回首项 → 无结果提示；
 * 打开工作空间 → 9 个目录分组（空目录空态）→ 点击文件进入右侧内联预览。
 *
 * 直接挂载 `App`（真实装配链路），只把全局 `fetch` 换成路由桩。
 */

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import App from '../../src/App.vue'
import type { Message } from '../../src/api/types'
import { SPACE_DIRECTORIES } from '../../src/constants/directories'
import { createFetchRouter, jsonResponse, waitFor } from '../helpers'

const AGENT = {
  agent_name: 'ops',
  description: '排产',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

/** `甲` 共出现 3 次：user 2 次 + assistant 1 次 */
const MESSAGES: Message[] = [
  {
    id: 'u1',
    role: 'user',
    content: '甲 甲 排产',
    ts: '2026-09-10T08:00:01.000Z',
    feedback: null,
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '甲的结果如下',
    ts: '2026-09-10T08:00:02.000Z',
    status: 'completed',
    feedback: null,
  },
]

const WORKSPACE_DIRS = SPACE_DIRECTORIES.map((item) => ({
  dir: item.dir,
  files:
    item.dir === '生产计划'
      ? [{ filename: 'plan.csv', size: 2048, updated_at: '2026-09-10T08:00:00.000Z' }]
      : [],
}))

function stubRouter(): ReturnType<typeof createFetchRouter> {
  const router = createFetchRouter({
    'GET /api/threads': () =>
      jsonResponse([
        {
          thread_id: 't1',
          agent_name: 'ops',
          title: '排产会话',
          created_at: '2026-09-10T08:00:00.000Z',
          updated_at: '2026-09-10T08:00:02.000Z',
        },
      ]),
    'GET /api/threads/t1': () =>
      jsonResponse({
        thread_id: 't1',
        agent_name: 'ops',
        title: '排产会话',
        created_at: '2026-09-10T08:00:00.000Z',
        updated_at: '2026-09-10T08:00:02.000Z',
        total: MESSAGES.length,
        messages: MESSAGES,
        running: false,
      }),
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    'GET /api/agents/ops': () => jsonResponse(AGENT),
    'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    'GET /api/files/workspace': () => jsonResponse({ dirs: WORKSPACE_DIRS }),
    'GET /api/files/preview': () =>
      new Response('a,b\n1,2', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
  })
  vi.stubGlobal('fetch', router.fetch)
  return router
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 挂载 App 并选中唯一会话 */
async function mountWithThread(): Promise<ReturnType<typeof mount>> {
  const wrapper = mount(App)
  await waitFor(() => wrapper.find('.history-item').exists(), '历史会话未渲染')
  await wrapper.find('.history-item__button').trigger('click')
  await waitFor(() => wrapper.findAll('.message-bubble').length === 2, '消息未渲染')
  return wrapper
}

describe('US8 集成：搜索与工作空间', () => {
  it('关键词高亮 + 逐次跳转 + 末尾循环', async () => {
    const router = stubRouter()
    const wrapper = await mountWithThread()

    // 初始无高亮
    expect(wrapper.findAll('.message-content__mark')).toHaveLength(0)

    // 打开搜索栏
    await wrapper.findAll('.chat-header__action')[0].trigger('click')
    await waitFor(() => wrapper.find('.session-search').exists(), '搜索栏未展开')

    // 输入关键词 → 高亮 3 处并首次定位到第 1 项
    await wrapper.find('.session-search__input').setValue('甲')
    await waitFor(() => wrapper.findAll('.message-content__mark').length === 3, '高亮数量不符')
    await waitFor(
      () => wrapper.findAll('[data-active-match="true"]').length === 1,
      '未定位到首个命中',
    )

    expect(wrapper.find('.session-search__status').text()).toBe('第 1 / 共 3 项')
    expect(wrapper.find('[data-active-match="true"]').attributes('data-match-index')).toBe('0')

    // 逐次跳转，末尾循环回首项（FR-030）
    const next = wrapper.find('.base-button--secondary')
    await next.trigger('click')
    await waitFor(() => wrapper.find('.session-search__status').text() === '第 2 / 共 3 项')
    expect(wrapper.find('[data-active-match="true"]').attributes('data-match-index')).toBe('1')

    await next.trigger('click')
    await waitFor(() => wrapper.find('.session-search__status').text() === '第 3 / 共 3 项')

    await next.trigger('click')
    await waitFor(() => wrapper.find('.session-search__status').text() === '第 1 / 共 3 项')
    expect(wrapper.find('[data-active-match="true"]').attributes('data-match-index')).toBe('0')

    // 无结果提示（US8 场景 3）
    await wrapper.find('.session-search__input').setValue('不存在')
    await waitFor(() => wrapper.find('.session-search__status').text() === '无匹配结果')
    expect(wrapper.findAll('.message-content__mark')).toHaveLength(0)

    // 关闭搜索栏
    await wrapper.find('[aria-label="关闭搜索"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.session-search').exists()).toBe(false)

    expect(router.countOf('GET', '/api/threads')).toBe(1)
    wrapper.unmount()
  })

  it('工作空间：9 个目录分组、空目录空态、点击文件进入预览', async () => {
    const router = stubRouter()
    const wrapper = await mountWithThread()

    // 打开工作空间抽屉
    await wrapper.findAll('.chat-header__action')[1].trigger('click')
    await waitFor(() => router.countOf('GET', '/api/files/workspace') === 1, '未拉取工作空间')
    await waitFor(
      () => wrapper.findAll('.workspace-drawer__group').length === 9,
      '目录分组数量不符',
    )

    expect(wrapper.findAll('.workspace-drawer__empty')).toHaveLength(8)
    expect(wrapper.find('.workspace-drawer__open').text()).toBe('plan.csv')

    // 点击文件 → 右侧内联预览，且抽屉收起
    await wrapper.find('.workspace-drawer__open').trigger('click')
    await waitFor(() => wrapper.find('.preview-panel__text').exists(), '预览未渲染')

    expect(wrapper.find('.preview-panel__filename').text()).toBe('plan.csv')
    expect(wrapper.find('.preview-panel__text').text()).toBe('a,b\n1,2')
    expect(router.countOf('GET', '/api/files/preview')).toBe(1)

    wrapper.unmount()
  })
})
