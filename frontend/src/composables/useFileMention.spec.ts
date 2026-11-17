/**
 * 单测：`@` 引用状态机的**光标记录**（2026-10-12，006 的接口补齐）。
 *
 * 背景（这正是一处真实缺陷的回归防线）：聊天侧浮层要"贴 `@` 光标右侧"弹出，
 * 因此读 `mention.caret`；但状态机此前**从未产出**该字段——组件测试里的打桩
 * 各自补了一个 `caret`，把"契约里根本没有它"这件事遮住了，直到 `typecheck`
 * 报 `Property 'caret' does not exist on type 'FileMentionStore'` 才暴露。
 *
 * 守住的语义只有两条：
 * 1. `caret` 是契约的一部分，且触发时记录的是**本次**输入的光标；
 * 2. 收起时归零——留着旧下标会让下一次定位从错误的位置起算。
 *
 * 其余行为（级联、上限、引用同步）不在本文件范围：它们属存量代码，
 * 按宪章「治理 § 适用范围与不追溯」，不为存量模块发起覆盖率补齐专项。
 */
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import type { FilesApi } from '../api/files'
import type { FileReference } from '../api/types'
import type { ToastStore } from './useToast'
import { createWorkspaceStore } from './useWorkspace'
import { createFileMentionStore } from './useFileMention'

function makeStore(thread?: () => string | null) {
  const files = {
    workspace: vi.fn().mockResolvedValue({
      scenario: 's1',
      spaces: [
        {
          name: '数据准备',
          agent_writable: false,
          upload_extensions: ['.csv'],
          dirs: [
            {
              dir: '数据准备/生产计划',
              label: '生产计划',
              deletable: true,
              files: [{ filename: 'plan.csv', size: 1, updated_at: '2026-10-12 10:00' }],
              fields: [],
            },
          ],
        },
      ],
    }),
    remove: vi.fn(),
  }
  const workspace = createWorkspaceStore({
    files: files as unknown as FilesApi,
    toast: { push: vi.fn() } as unknown as ToastStore,
  })
  return createFileMentionStore(thread === undefined ? { workspace } : { workspace, thread })
}

/**
 * 引用按会话分桶（023 v1.4）：修的是"会话 1 粘了文件没发、切到会话 2 再粘同名文件会多出
 * `(1)`，且那个看不见的引用还会跟着下一条消息发出去"。
 */
describe('useFileMention —— 引用按会话分桶', () => {
  const plan: FileReference = { dir: '数据准备/生产计划', filename: 'plan.csv' }

  it('切走存、切回取', async () => {
    const thread = ref<string | null>('th-1')
    const mention = makeStore(() => thread.value)
    mention.pickFile(plan)
    expect(mention.references.value).toEqual([plan])

    thread.value = 'th-2'
    await nextTick()
    expect(mention.references.value).toEqual([])

    thread.value = 'th-1'
    await nextTick()
    expect(mention.references.value).toEqual([plan])
  })

  it('自动建会话（null → 真 id）是接管，不是清空', async () => {
    const thread = ref<string | null>(null)
    const mention = makeStore(() => thread.value)
    mention.pickFile(plan)

    thread.value = 'th-new'
    await nextTick()

    expect(mention.references.value).toEqual([plan])
  })

  it('点「新建对话」（→ null）⇒ 视图态不带任何引用', async () => {
    const thread = ref<string | null>('th-1')
    const mention = makeStore(() => thread.value)
    mention.pickFile(plan)

    thread.value = null
    await nextTick()

    expect(mention.references.value).toEqual([])
  })

  it('不同会话互不影响：会话 2 里 pick 同名文件仍按原名（不再凭空出现 (1)）', async () => {
    const thread = ref<string | null>('th-1')
    const mention = makeStore(() => thread.value)
    mention.pickFile(plan)

    thread.value = 'th-2'
    await nextTick()

    expect(mention.references.value).toEqual([])
    expect(mention.pickFile(plan)).toBe(true)
    expect(mention.references.value).toEqual([plan])
  })
})

describe('useFileMention —— 光标记录（浮层定位的输入）', () => {
  it('触发时记录本次光标位置（面板据此紧贴 `@` 右侧）', () => {
    const mention = makeStore()

    mention.handleInput('@plan', 5)

    expect(mention.open.value).toBe(true)
    expect(mention.caret.value).toBe(5)

    // 继续输入：光标前移，记录随之更新（否则面板会停在旧坐标）
    mention.handleInput('@plan.', 6)
    expect(mention.caret.value).toBe(6)
  })

  it('未触发 `@` 时收起并归零（下一次定位不得从旧下标起算）', () => {
    const mention = makeStore()
    mention.handleInput('@plan', 5)
    expect(mention.caret.value).toBe(5)

    mention.handleInput('abc', 3)

    expect(mention.open.value).toBe(false)
    expect(mention.caret.value).toBe(0)
  })

  it('收起（Esc / 选完文件）同样归零', () => {
    const mention = makeStore()
    mention.handleInput('@plan', 5)

    mention.close()

    expect(mention.caret.value).toBe(0)
  })
})
