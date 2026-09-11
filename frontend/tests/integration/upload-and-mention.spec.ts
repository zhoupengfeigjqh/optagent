/**
 * US4 集成验收：上传 → `@` 引用 → 发送载荷
 *
 * 覆盖 quickstart 的 US4 独立测试路径：
 * 上传文件 → 输入 `@` → 展示 9 个空间目录 → 展开目录选择文件 → 正文插入 `@文件名`
 * → 发送时 `content` 去掉引用文本、`attachments` 携带真实 `{dir, filename}`（FR-016）。
 *
 * 另覆盖 V-15：引用文件已不存在时**提示且不发送**。
 */

import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChatPanel from '../../src/components/chat/ChatPanel.vue'
import type { FileReference, WorkspaceDir } from '../../src/api/types'
import {
  createFetchRouter,
  jsonResponse,
  makeFile,
  memoryStorage,
  mountInSession,
  sseFrame,
  sseResponse,
  waitFor,
  type FetchRouter,
} from '../helpers'

const AGENT = {
  agent_name: 'ops',
  description: '排产数字人',
  soul: '',
  skills: [],
  enabled_tools: [],
  mcp_servers: [],
}

/** 上传后的落盘名（后端追加时间戳，前端 MUST 直接采用）。 */
const SERVER_FILENAME = 'plan_20260910_100000.csv'
const TARGET_DIR = '生产计划'

function workspaceDirs(): WorkspaceDir[] {
  return [
    {
      dir: TARGET_DIR,
      files: [{ filename: SERVER_FILENAME, size: 1024, updated_at: '2026-09-10T10:00:00.000Z' }],
    },
  ]
}

/** 构造 `FileList`（jsdom 不提供可直接 new 的实现）。 */
function makeFileList(files: File[]): FileList {
  return {
    ...files,
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as unknown as FileList
}

function createRouter(options: { workspace: () => Response }): FetchRouter {
  return createFetchRouter({
    'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
    'GET /api/agents/ops': () => jsonResponse(AGENT),
    'GET /api/agents/current/mcp': () => jsonResponse({ mcp_servers: [] }),
    'GET /api/models': () => jsonResponse({ models: [{ model: 'qwen-max', is_default: true }] }),
    'GET /api/threads': () => jsonResponse([]),
    'POST /api/threads': () => jsonResponse({ thread_id: 't1', title: null }, 201),
    'GET /api/files/workspace': options.workspace,
    'POST /api/files/upload': () =>
      jsonResponse({ dir: TARGET_DIR, filename: SERVER_FILENAME, size: 1024 }, 201),
    'POST /api/threads/t1/messages': () =>
      sseResponse([
        sseFrame('content', { delta: '收到' }),
        sseFrame('done', {
          finish_reason: 'completed',
          usage: { input_tokens: 1, output_tokens: 1 },
          duration_seconds: 0.3,
          message_id: 'a1',
        }),
      ]),
    'GET /api/threads/t1': () =>
      jsonResponse({
        thread_id: 't1',
        agent_name: 'ops',
        title: null,
        created_at: '2026-09-10T10:00:00.000Z',
        updated_at: '2026-09-10T10:00:01.000Z',
        total: 0,
        messages: [],
        running: false,
      }),
  })
}

function mountChat(router: FetchRouter): {
  wrapper: VueWrapper
  session: ReturnType<typeof mountInSession>['session']
} {
  return mountInSession(ChatPanel, {
    props: { expanded: true },
    sessionOptions: { fetchImpl: router.fetch, storage: memoryStorage() },
  })
}

/** 通过加号上传一个文件，返回上传项元素等待其成功。 */
async function uploadFile(wrapper: VueWrapper, router: FetchRouter): Promise<void> {
  await wrapper.find('.composer-toolbar__left .base-button').trigger('click')
  await wrapper.findAll('.upload-menu__dir-button')[0].trigger('click')

  const input = wrapper.find('.upload-menu__input')
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: makeFileList([makeFile('plan.csv', 1024)]),
  })
  await input.trigger('change')

  await waitFor(() => router.countOf('POST', '/api/files/upload') === 1, '未发起上传')
  await waitFor(() => wrapper.find('.upload-item--success').exists(), '上传未成功')
}

/** 在输入区敲入 `@` 并同步光标，使面板展开。 */
async function typeMentionTrigger(wrapper: VueWrapper, text: string): Promise<void> {
  const textarea = wrapper.find('.composer__input')
  await textarea.setValue(text)
  ;(textarea.element as HTMLTextAreaElement).setSelectionRange(text.length, text.length)
  await textarea.trigger('input')
}

/** 进入文件阶段并等待清单加载完成。 */
async function openDirPicker(wrapper: VueWrapper): Promise<void> {
  await wrapper.findAll('.mention-picker__item')[0].trigger('click')
  await waitFor(
    () => wrapper.findAll('.mention-picker__item').some((item) => item.text().includes(SERVER_FILENAME)),
    '文件清单未加载',
  )
}

function lastMessageBody(router: FetchRouter): Record<string, unknown> {
  const bodies = router.bodiesOf('POST', '/api/threads/t1/messages')
  return bodies[bodies.length - 1] as Record<string, unknown>
}

describe('US4 集成：上传与 @ 引用', () => {
  it('上传 → @ 展开 9 个目录 → 选择文件 → 发送以结构化引用提交', async () => {
    const router = createRouter({ workspace: () => jsonResponse({ dirs: workspaceDirs() }) })
    const { wrapper, session } = mountChat(router)

    await session.agents.loadCurrent()

    // 1. 加号上传：落盘名取响应中的 `filename`
    await uploadFile(wrapper, router)
    expect(wrapper.find('.upload-item__name').text()).toBe(SERVER_FILENAME)

    // 2. 输入 `@` → 面板展开并固定展示 9 个目录（SC-021）
    await typeMentionTrigger(wrapper, '看一下 @')
    const picker = wrapper.find('.mention-picker')
    expect(picker.exists()).toBe(true)
    expect(picker.findAll('.mention-picker__item')).toHaveLength(9)

    // 3. 进入目录 → 文件阶段展示该目录文件，选中后正文插入 `@文件名`
    await openDirPicker(wrapper)
    await wrapper.findAll('.mention-picker__item')[0].trigger('click')

    expect(session.mention.references.value).toEqual([
      { dir: TARGET_DIR, filename: SERVER_FILENAME },
    ])
    expect(session.chat.draft.value).toBe(`看一下 @${SERVER_FILENAME} `)
    // 选完即收起面板
    expect(wrapper.find('.mention-picker').exists()).toBe(false)

    // 4. 发送：正文去引用标记，attachments 携带真实目录 + 文件名（FR-016）
    await wrapper.find('.base-button--primary').trigger('click')
    await waitFor(
      () => router.countOf('POST', '/api/threads/t1/messages') === 1,
      '未发起流式请求',
    )

    const body = lastMessageBody(router)
    expect(body.content).toBe('看一下')
    expect(body.content).not.toContain(SERVER_FILENAME)
    expect(body.attachments).toEqual([{ dir: TARGET_DIR, filename: SERVER_FILENAME }])
  })

  it('引用文件已不存在时提示且不发送（V-15）', async () => {
    let workspaceCalls = 0
    const router = createRouter({
      workspace: () => {
        workspaceCalls += 1
        // 首次返回含该文件的清单，之后清单中已无该文件
        return jsonResponse({ dirs: workspaceCalls === 1 ? workspaceDirs() : [] })
      },
    })
    const { wrapper, session } = mountChat(router)

    await session.agents.loadCurrent()

    await typeMentionTrigger(wrapper, '看一下 @')
    await openDirPicker(wrapper)
    await wrapper.findAll('.mention-picker__item')[0].trigger('click')
    expect(session.mention.references.value).toHaveLength(1)

    // 再次进入目录会刷新清单（此时已不含该文件）
    await typeMentionTrigger(wrapper, `看一下 @${SERVER_FILENAME} @`)
    await wrapper.findAll('.mention-picker__item')[0].trigger('click')
    await waitFor(() => workspaceCalls >= 2, '工作空间清单未刷新')
    await waitFor(
      () => session.workspace.dirs.value.every((dir) => dir.files.length === 0),
      '工作空间状态未收敛',
    )

    const reference: FileReference = { dir: TARGET_DIR, filename: SERVER_FILENAME }
    expect(session.workspace.exists(reference)).toBe(false)

    await wrapper.find('.base-button--primary').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))

    // 未发起任何消息请求，且给出提示
    expect(router.countOf('POST', '/api/threads/t1/messages')).toBe(0)
    expect(session.toast.items.value.some((item) => item.text.includes('已不存在'))).toBe(true)
  })
})
