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
