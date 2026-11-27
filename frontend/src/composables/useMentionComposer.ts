import { type Ref } from 'vue'

import type { FileReference } from '../api/types'
import { mentionToken, stripMentionTokens, type FileMentionStore } from './useFileMention'

export interface MentionComposerDeps {
  mention: FileMentionStore
  draft: Ref<string>
}

export interface MentionComposer {
  onInputText(payload: { value: string; caret: number }): void
  onPickSpace(space: string): void
  onPickDir(dir: string): void
  /**
   * 选中一个文件：登记引用 + 写 `@标记`。
   *
   * @returns 是否真的收下（`false` = 超上限或已在引用中，文本不变）。粘贴待发批次
   *   要据此决定"这份内存文件还要不要留着"，故不能只是 void。
   */
  onPickFile(reference: FileReference): boolean
  onConfirmMention(): void
  onMentionKey(key: string): void
  onRemoveReference(reference: FileReference): void
}

export function useMentionComposer(deps: MentionComposerDeps): MentionComposer {
  const { mention, draft } = deps

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

  function onPickFile(reference: FileReference): boolean {
    if (!mention.pickFile(reference)) {
      return false
    }
    insertToken(reference)
    mention.close()
    return true
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
