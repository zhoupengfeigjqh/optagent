import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FileReference, WorkspaceFile } from '../api/types'
import { SPACE_DIRECTORIES } from '../constants/directories'
import { MAX_REFERENCES_PER_MESSAGE } from '../constants/limits'
import { createFileMentionStore, stripMentionTokens } from './useFileMention'
import type { ToastStore } from './useToast'
import type { WorkspaceStore } from './useWorkspace'

const WORKSPACE_FILES: Record<string, WorkspaceFile[]> = {
  生产计划: [
    { filename: '计划_1.csv', size: 10, updated_at: '2026-09-10T00:00:00Z' },
    { filename: '计划_2.csv', size: 20, updated_at: '2026-09-10T00:00:00Z' },
  ],
  tmp: [{ filename: '草稿.txt', size: 5, updated_at: '2026-09-10T00:00:00Z' }],
}

function makeWorkspace(): WorkspaceStore {
  const dirs = SPACE_DIRECTORIES.map((item) => ({
    dir: item.dir,
    files: WORKSPACE_FILES[item.dir] ?? [],
  }))
  return {
    dirs: ref(dirs),
    loading: ref(false),
    error: ref(null),
    expandedDirs: ref<readonly string[]>([]),
    load: vi.fn(async () => undefined),
    filesOf: (dir: string) => dirs.find((item) => item.dir === dir)?.files ?? [],
    exists: (reference: FileReference) =>
      (WORKSPACE_FILES[reference.dir] ?? []).some(
        (file) => file.filename === reference.filename,
      ),
    toggleDir: vi.fn(),
    remove: vi.fn(async () => true),
  }
}

function makeToast(): { toast: ToastStore; pushed: string[] } {
  const pushed: string[] = []
  const toast: ToastStore = {
    items: ref([]),
    push: (_level, text) => {
      pushed.push(text)
      return `t-${pushed.length}`
    },
    dismiss: () => undefined,
    runAction: () => undefined,
    clear: () => undefined,
  }
  return { toast, pushed }
}

function makeStore() {
  const workspace = makeWorkspace()
  const { toast, pushed } = makeToast()
  return { store: createFileMentionStore({ workspace, toast }), workspace, pushed }
}

describe('useFileMention - 触发与阶段（FR-014、FR-015）', () => {
  it('光标前出现 @ 时打开目录阶段面板', () => {
    const { store } = makeStore()

    store.handleInput('请参考 @', 5)

    expect(store.open.value).toBe(true)
    expect(store.stage.value).toBe('dir')
    expect(store.optionCount.value).toBe(9)
  })

  it('行首 @ 也能触发', () => {
    const { store } = makeStore()

    store.handleInput('@', 1)

    expect(store.open.value).toBe(true)
  })

  it('@ 后已有空格时不触发（视为普通文本）', () => {
    const { store } = makeStore()

    store.handleInput('@ 空格', 4)

    expect(store.open.value).toBe(false)
  })

  it('pickDir 进入文件阶段并刷新工作空间', () => {
    const { store, workspace } = makeStore()
    store.handleInput('@', 1)

    store.pickDir('生产计划')

    expect(store.stage.value).toBe('file')
    expect(store.activeDir.value).toBe('生产计划')
    expect(store.files.value.map((item) => item.filename)).toEqual(['计划_1.csv', '计划_2.csv'])
    expect(workspace.load).toHaveBeenCalledTimes(1)
  })

  it('目录列表与三处 UI 同源（SC-021）', () => {
    const { store } = makeStore()

    expect(store.directories).toBe(SPACE_DIRECTORIES)
  })
})

describe('useFileMention - 引用管理与上限（FR-017、V-02）', () => {
  it('pickFile 加入引用并返回 true', () => {
    const { store } = makeStore()

    expect(store.pickFile({ dir: '生产计划', filename: '计划_1.csv' })).toBe(true)
    expect(store.references.value).toEqual([{ dir: '生产计划', filename: '计划_1.csv' }])
  })

  it('重复引用被忽略', () => {
    const { store } = makeStore()
    store.pickFile({ dir: '生产计划', filename: '计划_1.csv' })

    expect(store.pickFile({ dir: '生产计划', filename: '计划_1.csv' })).toBe(false)
    expect(store.references.value).toHaveLength(1)
  })

  it('达到 10 个引用后 pickFile 被拒绝并提示（FR-017）', () => {
    const { store, pushed } = makeStore()
    for (let index = 0; index < MAX_REFERENCES_PER_MESSAGE; index += 1) {
      expect(store.pickFile({ dir: 'tmp', filename: `f${index}.csv` })).toBe(true)
    }

    const accepted = store.pickFile({ dir: 'tmp', filename: 'overflow.csv' })

    expect(accepted).toBe(false)
    expect(store.references.value).toHaveLength(MAX_REFERENCES_PER_MESSAGE)
    expect(store.maxReached.value).toBe(true)
    expect(pushed.join()).toContain(String(MAX_REFERENCES_PER_MESSAGE))
  })

  it('remove 移除指定引用', () => {
    const { store } = makeStore()
    store.pickFile({ dir: 'tmp', filename: 'a.csv' })
    store.pickFile({ dir: 'tmp', filename: 'b.csv' })

    store.remove({ dir: 'tmp', filename: 'a.csv' })

    expect(store.references.value).toEqual([{ dir: 'tmp', filename: 'b.csv' }])
  })

  it('reset 清空引用并收起面板', () => {
    const { store } = makeStore()
    store.handleInput('@', 1)
    store.pickFile({ dir: 'tmp', filename: 'a.csv' })

    store.reset()

    expect(store.references.value).toEqual([])
    expect(store.open.value).toBe(false)
  })
})

describe('useFileMention - 文本与引用同步（US4 场景 8）', () => {
  it('删除文本中的 @文件名 后引用同步移除', () => {
    const { store } = makeStore()
    store.pickFile({ dir: 'tmp', filename: 'a.csv' })
    store.pickFile({ dir: 'tmp', filename: 'b.csv' })

    // 用户把 "@a.csv" 删掉了，只留 "@b.csv"
    store.handleInput('请参考 @b.csv', 10)

    expect(store.references.value).toEqual([{ dir: 'tmp', filename: 'b.csv' }])
  })

  it('删除触发 @ 后收起面板', () => {
    const { store } = makeStore()
    store.handleInput('@', 1)
    expect(store.open.value).toBe(true)

    store.handleInput('', 0)

    expect(store.open.value).toBe(false)
    expect(store.stage.value).toBe('dir')
    expect(store.activeIndex.value).toBe(0)
  })

  it('引用全部被删除后列表为空', () => {
    const { store } = makeStore()
    store.pickFile({ dir: 'tmp', filename: 'a.csv' })

    store.handleInput('没有引用了', 5)

    expect(store.references.value).toEqual([])
  })
})

describe('useFileMention - 键盘与提交载荷', () => {
  it('move 在目录阶段循环移动', () => {
    const { store } = makeStore()
    store.handleInput('@', 1)

    store.move(-1)
    expect(store.activeIndex.value).toBe(8)

    store.move(1)
    expect(store.activeIndex.value).toBe(0)
  })

  it('move 在文件阶段按文件数循环', () => {
    const { store } = makeStore()
    store.pickDir('生产计划')

    store.move(1)
    expect(store.activeIndex.value).toBe(1)

    store.move(1)
    expect(store.activeIndex.value).toBe(0)
  })

  it('文件为空时 move 保持 0', () => {
    const { store } = makeStore()
    store.pickDir('产线信息')

    store.move(1)

    expect(store.activeIndex.value).toBe(0)
  })

  it('buildAttachments 输出结构化数组（FR-016）', () => {
    const { store } = makeStore()
    store.pickFile({ dir: '生产计划', filename: '计划_1.csv' })

    const attachments = store.buildAttachments()

    expect(attachments).toEqual([{ dir: '生产计划', filename: '计划_1.csv' }])
    // 返回副本，外部改动不影响内部状态
    attachments.push({ dir: 'tmp', filename: 'x' })
    expect(store.references.value).toHaveLength(1)
  })

  it('missingReferences 返回已失效的引用（V-15）', () => {
    const { store } = makeStore()
    store.pickFile({ dir: '生产计划', filename: '计划_1.csv' })
    store.pickFile({ dir: '生产计划', filename: '已删除.csv' })

    expect(store.missingReferences()).toEqual([{ dir: '生产计划', filename: '已删除.csv' }])
  })
})

describe('useFileMention - stripMentionTokens（FR-016 提交层正文）', () => {
  const reference = { dir: '生产计划', filename: 'plan.csv' }

  it('移除标记并规整空白', () => {
    expect(stripMentionTokens('看一下 @plan.csv 这个文件', [reference])).toBe('看一下 这个文件')
  })

  it('标记位于开头时同样移除', () => {
    expect(stripMentionTokens('@plan.csv 帮我看看', [reference])).toBe('帮我看看')
  })

  it('无标记时仅去除首尾空白', () => {
    expect(stripMentionTokens('  你好  ', [])).toBe('你好')
  })

  it('仅含标记时返回空串（调用方据此拦下发送）', () => {
    expect(stripMentionTokens('@plan.csv', [reference])).toBe('')
  })

  it('多个引用按标记逐个移除', () => {
    const other = { dir: 'shared', filename: 'rule.txt' }
    expect(stripMentionTokens('@plan.csv 与 @rule.txt 对比', [reference, other])).toBe('与 对比')
  })
})
