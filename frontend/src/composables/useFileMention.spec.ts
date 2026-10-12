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

import type { FilesApi } from '../api/files'
import type { ToastStore } from './useToast'
import { createWorkspaceStore } from './useWorkspace'
import { createFileMentionStore } from './useFileMention'

function makeStore() {
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
  return createFileMentionStore({ workspace })
}

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
