
import { onBeforeUnmount, watch } from 'vue'

export interface MaximizeEscapeDeps {
  active: () => boolean
  onRestore: () => void
}

const boundFrames = new WeakSet<Document>()

function isEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
}

function hasOpenDialog(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null
}

export function useMaximizeEscape(deps: MaximizeEscapeDeps): void {
  let attached = false

  function onKeydown(event: KeyboardEvent): void {
    if (!isEscape(event) || hasOpenDialog()) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    deps.onRestore()
  }

  function attach(): void {
    if (attached || typeof window === 'undefined') {
      return
    }
    window.addEventListener('keydown', onKeydown, true)
    attached = true
  }

  function detach(): void {
    if (!attached || typeof window === 'undefined') {
      return
    }
    window.removeEventListener('keydown', onKeydown, true)
    attached = false
  }

  watch(
    () => deps.active(),
    (value) => (value ? attach() : detach()),
    { immediate: true },
  )
  onBeforeUnmount(detach)
}

/**
 * 把同源 iframe 文档内的 Esc 转成一次"退出放大"。
 *
 * `doc` 为 `null`（跨域 / PDF 插件文档拿不到）时**安全返回，不假装成功**；
 * 同一文档只绑一次（重复 `load` 不叠加监听）。监听本身随 iframe 文档一起销毁，
 * 无需显式解绑；清不掉的是 `boundFrames` 里的一个弱引用，由 GC 回收。
 */
export function bindFrameEscape(doc: Document | null, onRestore: () => void): void {
  if (doc === null || boundFrames.has(doc)) {
    return
  }
  boundFrames.add(doc)
  doc.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (!isEscape(event)) {
        return
      }
      event.preventDefault()
      onRestore()
    },
    true,
  )
}
