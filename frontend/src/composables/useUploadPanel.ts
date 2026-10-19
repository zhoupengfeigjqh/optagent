/**
 * 上传面板接线（012）：开关 / 收起清空终态记录 / 逐文件上传 / 重试 / **成功即回写 `@落盘名`**。
 *
 * 为什么单独成文件：
 * 1. `useChatPanel.ts` 已逼近 500 行硬门禁（宪章原则二），内联回写逻辑必超；
 * 2. 面板接线本身是独立职责（开关 + 清空 + 回写），单独成文件才能被同名测试直接钉住。
 *
 * 两条关键约定：
 * - **回写复用唯一入口**：`acceptUpload` 由调用方传 `mentionComposer.onPickFile`，
 *   因此拼写（`mentionToken`）、上限（10）、去重与提示都只有一处实现（原则二）；
 * - **先登记清单、后写标记**：`workspace.registerFile` 让发送前的 `exists` 立刻为真，
 *   否则用户会"看到 `@` 却发不出去"（012 FR-004）。
 */
import { ref, watch, type Ref } from 'vue'

import type { FileReference } from '../api/types'
import type { UploadsStore } from './useUploads'
import type { WorkspaceStore } from './useWorkspace'

/** 构造参数。 */
export interface UploadPanelDeps {
  uploads: UploadsStore
  workspace: WorkspaceStore
  /** 复用 `mentionComposer.onPickFile`：登记引用 + 写 `@标记` + 上限/去重/提示 */
  acceptUpload: (reference: FileReference) => void
}

/** 上传面板契约（`useChatPanel` 原样导出这几个名字，视图不受影响）。 */
export interface UploadPanel {
  uploadOpen: Readonly<Ref<boolean>>
  onToggleUpload(): void
  onCloseUpload(): void
  onPickFiles(payload: { dir: string; files: FileList }): void
  onRetryUpload(localId: string): void
}

export function useUploadPanel(deps: UploadPanelDeps): UploadPanel {
  const uploadOpen = ref(false)
  /**
   * 已回写过的项（按 `localId` 去重）。
   * 重试导致同一项二次成功时 MUST NOT 再插一个 `@`（012 不变式 I2）。
   */
  const echoed = new Set<string>()

  /** 收起：清空终态记录（进行中的保留），不动文件、`@` 与引用（FR-010 / FR-011 / FR-013） */
  function collapse(): void {
    uploadOpen.value = false
    deps.uploads.clear()
  }

  function onToggleUpload(): void {
    if (uploadOpen.value) {
      collapse()
      return
    }
    uploadOpen.value = true
    // 目录树取自 workspace 接口：展开时若还没有目录就补一次加载，
    // 否则"进页面直接点加号"时目录为空，只会看到兜底文案
    if (deps.workspace.spaces.value.length === 0 && !deps.workspace.loading.value) {
      void deps.workspace.load()
    }
  }

  function onCloseUpload(): void {
    collapse()
  }

  function onPickFiles(payload: { dir: string; files: FileList }): void {
    // 扩展名白名单按目标空间下发（workspace 接口），数据准备仅 csv/xlsx
    void deps.uploads.upload(
      payload.dir,
      Array.from(payload.files),
      deps.workspace.uploadExtensionsOf(payload.dir),
    )
  }

  function onRetryUpload(localId: string): void {
    void deps.uploads.retry(localId)
  }

  // 成功即回写：`items` 一律不可变替换，故监听数组本身即可覆盖初次成功与重试成功
  watch(
    () => deps.uploads.items.value,
    (items) => {
      for (const item of items) {
        if (item.status !== 'success' || !item.serverFilename || echoed.has(item.localId)) {
          continue
        }
        echoed.add(item.localId)
        // 顺序不可颠倒：先让 exists 为真，再写 `@`（否则可能出现"标记在、引用不可发"）
        deps.workspace.registerFile({
          dir: item.dir,
          filename: item.serverFilename,
          size: item.size,
        })
        deps.acceptUpload({ dir: item.dir, filename: item.serverFilename })
      }
    },
  )

  return { uploadOpen, onToggleUpload, onCloseUpload, onPickFiles, onRetryUpload }
}
