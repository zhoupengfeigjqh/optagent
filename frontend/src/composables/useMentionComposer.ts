/**
 * `@` 引用在输入区的落字与按键路由（2026-10-16，自 `useChatPanel.ts` 抽出）
 *
 * 抽出来的理由：这一组动作只做两件事——把选中的文件落成正文里的 `@文件名` 标记、
 * 把浮层里的按键转给 `useFileMention`；它自带**文本与引用必须同步**这条不变式
 * （标记删掉、引用跟着删；引用删掉、标记跟着删），与本轮发送链路没有耦合。
 * 搬运时行为零变化（宪章原则二：单文件 ≤500 行）。
 *
 * 唯一入口的纪律：标记的**拼写**只由 `mentionToken` 决定，**剥离**只由 `stripMentionTokens`
 * 决定——两处都不在本文件里各写一遍正则，否则显示文本与提交载荷迟早对不上。
 */
import { type Ref } from 'vue'

import type { FileReference } from '../api/types'
import { mentionToken, stripMentionTokens, type FileMentionStore } from './useFileMention'

/** 创建参数。 */
export interface MentionComposerDeps {
  /** `@` 引用状态（浮层与引用集合） */
  mention: FileMentionStore
  /** 输入区文本（读写） */
  draft: Ref<string>
}

/** 输入区侧 `@` 引用接线。 */
export interface MentionComposer {
  /** 文本/光标变化：检测 `@` 触发，并同步移除已从正文删除的引用 */
  onInputText(payload: { value: string; caret: number }): void
  onPickSpace(space: string): void
  onPickDir(dir: string): void
  onPickFile(reference: FileReference): void
  /** Enter/→ 确认当前高亮项：空间/目录列下钻，文件列完成引用 */
  onConfirmMention(): void
  /** `@` 面板展开时的按键路由（Composer 已拦截并 preventDefault） */
  onMentionKey(key: string): void
  /** 移除引用时同步删除正文中的标记 */
  onRemoveReference(reference: FileReference): void
}

export function useMentionComposer(deps: MentionComposerDeps): MentionComposer {
  const { mention, draft } = deps

  /** 用完整标记替换触发片段（`…@pl` → `…@plan.csv `），便于按标记同步引用。 */
  function insertToken(reference: FileReference): void {
    const replaced = draft.value.replace(/(^|\s)@[^\s@]*$/, '$1')
    draft.value = `${replaced}${mentionToken(reference)} `
  }

  function onInputText(payload: { value: string; caret: number }): void {
    mention.handleInput(payload.value, payload.caret)
  }

  function onPickSpace(space: string): void {
    mention.pickSpace(space)
  }

  function onPickDir(dir: string): void {
    mention.pickDir(dir)
  }

  function onPickFile(reference: FileReference): void {
    if (!mention.pickFile(reference)) {
      return
    }
    insertToken(reference)
    mention.close()
  }

  function onConfirmMention(): void {
    const reference = mention.confirmActive()
    if (reference) {
      onPickFile(reference)
    }
  }

  function onMentionKey(key: string): void {
    switch (key) {
      case 'ArrowDown':
        mention.move(1)
        break
      case 'ArrowUp':
        mention.move(-1)
        break
      case 'ArrowRight':
      case 'Enter':
        onConfirmMention()
        break
      case 'ArrowLeft':
        mention.back()
        break
      case 'Escape':
        // 关闭面板但不丢文本（US4 场景 8）
        mention.close()
        break
      default:
        break
    }
  }

  function onRemoveReference(reference: FileReference): void {
    mention.remove(reference)
    draft.value = stripMentionTokens(draft.value, [reference])
  }

  return {
    onInputText,
    onPickSpace,
    onPickDir,
    onPickFile,
    onConfirmMention,
    onMentionKey,
    onRemoveReference,
  }
}
