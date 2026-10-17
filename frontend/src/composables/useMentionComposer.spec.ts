/**
 * 单元测试：`@` 引用的输入区接线（2026-10-16，拆分产出）。
 *
 * 唯一入口的纪律在这里被钉住：标记的**拼写**只由 `mentionToken` 决定、**剥离**只由
 * `stripMentionTokens` 决定——所以断言都拿 `mentionToken` 反推，而不是硬写 `@plan.csv`。
 * 只要哪天有人在这条链路上另写一份正则，这些用例就会红。
 */
import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import type { FileReference } from '../api/types'
import {
  mentionToken,
  type FileMentionStore,
  type MentionColumn,
} from './useFileMention'
import { useMentionComposer } from './useMentionComposer'

const PLAN: FileReference = { dir: '生产计划', filename: 'plan.csv' }
const BOM: FileReference = { dir: '共享空间', filename: 'bom.csv' }

/** 只实现本模块用到的出口；未用到的状态给最小合法值（避免为一个接线测试拉起整棵空间树）。 */
function makeMention(overrides: Partial<FileMentionStore> = {}): FileMentionStore {
  return {
    open: ref(false),
    caret: ref(0),
    spaces: computed(() => []),
    column: ref<MentionColumn>('space'),
    activeSpace: ref<string | null>(null),
    activeDir: ref<string | null>(null),
    activeIndex: ref(0),
    references: ref<FileReference[]>([]),
    dirs: computed(() => []),
    files: computed(() => []),
    maxReached: computed(() => false),
    handleInput: vi.fn(),
    pickSpace: vi.fn(),
    pickDir: vi.fn(),
    pickFile: vi.fn(() => true),
    move: vi.fn(),
    confirmActive: vi.fn((): FileReference | null => null),
    back: vi.fn(),
    close: vi.fn(),
    remove: vi.fn(),
    reset: vi.fn(),
    buildAttachments: vi.fn(() => []),
    missingReferences: vi.fn(() => []),
    ...overrides,
  }
}

describe('useMentionComposer —— 转发与落字（2026-10-16）', () => {
  it('文本/光标变化转给浮层检测', () => {
    const mention = makeMention()
    const draft = ref('看下 @pl')
    useMentionComposer({ mention, draft }).onInputText({ value: '看下 @pl', caret: 7 })

    expect(mention.handleInput).toHaveBeenCalledWith('看下 @pl', 7)
  })

  it('空间 / 二级目录的点击各自转发', () => {
    const mention = makeMention()
    const composer = useMentionComposer({ mention, draft: ref('') })

    composer.onPickSpace('数据准备')
    composer.onPickDir('生产计划')

    expect(mention.pickSpace).toHaveBeenCalledWith('数据准备')
    expect(mention.pickDir).toHaveBeenCalledWith('生产计划')
  })

  it('选中文件：用完整标记替换触发片段，并收起浮层', () => {
    const mention = makeMention()
    const draft = ref('看下 @pl')
    const composer = useMentionComposer({ mention, draft })

    composer.onPickFile(PLAN)

    expect(draft.value).toBe(`看下 ${mentionToken(PLAN)} `)
    expect(mention.close).toHaveBeenCalledTimes(1)
  })

  it('引用超限（pickFile 返回 false）：不改文本、不收起浮层（提示由浮层自己给）', () => {
    const mention = makeMention({ pickFile: vi.fn(() => false) })
    const draft = ref('看下 @pl')
    const composer = useMentionComposer({ mention, draft })

    composer.onPickFile(PLAN)

    expect(draft.value).toBe('看下 @pl')
    expect(mention.close).not.toHaveBeenCalled()
  })

  it('移除引用：同时删掉正文里的标记（文本与引用不许各走一套）', () => {
    const mention = makeMention()
    const draft = ref(`看下 ${mentionToken(PLAN)} 和 ${mentionToken(BOM)}`)
    const composer = useMentionComposer({ mention, draft })

    composer.onRemoveReference(PLAN)

    expect(mention.remove).toHaveBeenCalledWith(PLAN)
    expect(draft.value).not.toContain(mentionToken(PLAN))
    expect(draft.value).toContain(mentionToken(BOM))
  })
})

describe('useMentionComposer —— 确认与按键路由（2026-10-16）', () => {
  it('确认当前高亮项：文件列返回引用时走同一条落字路径', () => {
    const mention = makeMention({ confirmActive: vi.fn(() => PLAN) })
    const draft = ref('看下 @pl')
    const composer = useMentionComposer({ mention, draft })

    composer.onConfirmMention()

    expect(draft.value).toBe(`看下 ${mentionToken(PLAN)} `)
    expect(mention.close).toHaveBeenCalled()
  })

  it('确认时仍在空间/目录列（返回 null）：什么也不做', () => {
    const mention = makeMention()
    const draft = ref('看下 @pl')
    const composer = useMentionComposer({ mention, draft })

    composer.onConfirmMention()

    expect(draft.value).toBe('看下 @pl')
    expect(mention.close).not.toHaveBeenCalled()
  })

  it('按键路由：上下移动 / 左右下钻回退 / 回车确认 / Esc 只收面板不动文本', () => {
    const mention = makeMention()
    const draft = ref('看下 @pl')
    const composer = useMentionComposer({ mention, draft })

    composer.onMentionKey('ArrowDown')
    composer.onMentionKey('ArrowUp')
    composer.onMentionKey('ArrowLeft')
    composer.onMentionKey('Escape')
    composer.onMentionKey('Enter')

    expect(mention.move).toHaveBeenNthCalledWith(1, 1)
    expect(mention.move).toHaveBeenNthCalledWith(2, -1)
    expect(mention.back).toHaveBeenCalledTimes(1)
    expect(mention.close).toHaveBeenCalledTimes(1)
    expect(mention.confirmActive).toHaveBeenCalledTimes(1)
    expect(draft.value).toBe('看下 @pl')
  })

  it('右键与回车等价下钻', () => {
    const mention = makeMention()
    const composer = useMentionComposer({ mention, draft: ref('@') })

    composer.onMentionKey('ArrowRight')

    expect(mention.confirmActive).toHaveBeenCalledTimes(1)
  })

  it('未知按键：一律不转发（不吞输入）', () => {
    const mention = makeMention()
    const composer = useMentionComposer({ mention, draft: ref('@') })

    composer.onMentionKey('a')

    expect(mention.move).not.toHaveBeenCalled()
    expect(mention.confirmActive).not.toHaveBeenCalled()
    expect(mention.close).not.toHaveBeenCalled()
  })
})
