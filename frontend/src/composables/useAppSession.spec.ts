import { describe, expect, it } from 'vitest'

import { createFetchRouter, jsonResponse, memoryStorage } from '../../tests/helpers'
import { createAppSession, useAppSession, useSession } from './useAppSession'
import { useAgents } from './useAgents'

describe('createAppSession - 装配（D4）', () => {
  it('返回契约约定的全部领域 store', () => {
    const session = createAppSession({ fetchImpl: createFetchRouter({}).fetch })

    for (const key of [
      'agents',
      'threads',
      'chat',
      'models',
      'uploads',
      'workspace',
      'search',
      'preview',
      'toast',
      'mention',
    ] as const) {
      expect(session[key]).toBeTruthy()
    }
    expect(typeof session.now).toBe('function')
  })

  it('注入的时钟被透传（测试可用假时钟）', () => {
    const session = createAppSession({
      fetchImpl: createFetchRouter({}).fetch,
      now: () => 42,
    })

    expect(session.now()).toBe(42)
  })

  it('装配后可直接完成一次端到端调用（models.load）', async () => {
    const router = createFetchRouter({
      'GET /api/models': () =>
        jsonResponse({
          models: [
            { model: 'qwen-max', is_default: true },
            { model: 'gpt-4o', is_default: false },
          ],
        }),
    })
    const session = createAppSession({
      fetchImpl: router.fetch,
      storage: memoryStorage(),
    })

    await session.models.load()

    expect(session.models.current.value).toBe('qwen-max')
  })

  it('工作空间与预览共享同一 FilesApi（同源直链）', async () => {
    const router = createFetchRouter({
      'GET /api/files/workspace': () => jsonResponse({ dirs: [] }),
    })
    const session = createAppSession({ fetchImpl: router.fetch })

    await session.workspace.load()
    await session.preview.openFile({ dir: 'tmp', filename: 'a.xlsx' })

    expect(session.workspace.dirs.value).toHaveLength(9)
    expect(session.preview.content.value?.url).toContain('/api/files/download?')
  })

  it('chat 与 threads 共享同一当前会话 id（单一事实源）', async () => {
    const router = createFetchRouter({
      'POST /api/threads': () =>
        jsonResponse({ thread_id: 't-1', title: null, created_at: '2026-09-10T00:00:00Z' }, 201),
      'GET /api/agents/current': () => jsonResponse({ agent_name: 'ops' }),
      'GET /api/agents/ops': () =>
        jsonResponse({
          agent_name: 'ops',
          soul: '',
          skills: [],
          enabled_tools: [],
          mcp_servers: [],
        }),
      'GET /api/agents/current/mcp': () => jsonResponse({ agent_name: 'ops', mcp_servers: [] }),
      'GET /api/threads': () => jsonResponse([]),
    })
    const session = createAppSession({ fetchImpl: router.fetch, storage: memoryStorage() })

    await session.agents.loadCurrent()
    await session.threads.create()

    expect(session.threads.activeId.value).toBe('t-1')
    // 新会话建立后流式状态被重置为 idle
    expect(session.chat.phase.value).toBe('idle')
  })
})

describe('useSession / useAgents - 注入缺失时的行为', () => {
  it('未提供会话上下文时抛出明确错误', () => {
    expect(() => useSession()).toThrow(/未找到会话上下文/)
  })

  it('领域访问器在缺少注入时同样抛出', () => {
    expect(() => useAgents()).toThrow(/未找到会话上下文/)
  })

  it('组件外调用 useAppSession 只装配不 provide（不报错）', () => {
    const session = useAppSession({ fetchImpl: createFetchRouter({}).fetch })

    expect(session.toast.items.value).toEqual([])
    expect(() => useSession()).toThrow()
  })
})
