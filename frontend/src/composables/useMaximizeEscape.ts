/**
 * 放大态下按 Esc 退出（2026-10-16，011）
 *
 * 单栏工作台里已有一个全局 Esc：中栏的"Esc 中断本轮回答"。放大态的 Esc 必须**只退出放大**，
 * 不能顺手掐掉正在输出的回答。因此这里的两条载体都刻意与它错开：
 *
 * - `useMaximizeEscape`：**只在该放大态为真时**在 `window` 上挂监听，且用**捕获阶段**。
 *   中栏那个监听在冒泡阶段（同级 `window`），捕获先执行；我们 `stopPropagation()` 之后
 *   它根本收不到事件。非放大态**完全不挂**监听 ⇒ "改动前的 Esc 行为零变化"是结构性的，
 *   不需要在聊天组件里加任何"预览是否在放大"的判断。
 * - `bindFrameEscape`：同源 `iframe` 是**独立文档**，其中按下的 Esc 不会冒泡到本页 `window`，
 *   而 iframe 页面正是放大的主场景（用户会先点进页面里翻）。同源才拿得到 `contentDocument`，
 *   与既有 `ensureInnerScroll` 的边界完全一致；跨域地址本就直跳新窗口，不进面板。
 *
 * 有打开的 `<dialog>` 时一律放行：确认删除这类弹窗的原生 Esc 语义优先于退出放大——
 * 否则用户按 Esc 想关弹窗，结果是弹窗还开着、放大先退了。
 */

import { onBeforeUnmount, watch } from 'vue'

/** 构造参数：以取值函数与回调注入，便于测试替换。 */
export interface MaximizeEscapeDeps {
  /** 是否处于放大态（只在为真时挂全局监听） */
  active: () => boolean
  /** 命中 Esc 且无弹窗时的动作（退出放大） */
  onRestore: () => void
}

/** 已绑过 Esc 转发的 iframe 文档：同一文档多次 `load` 只绑一次 */
const boundFrames = new WeakSet<Document>()

function isEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape'
}

/** 当前是否有打开的 `<dialog>`（原生弹窗的 Esc 优先） */
function hasOpenDialog(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null
}

/**
 * 放大态期间监听 Esc 并退出放大（需在组件 `setup` 内调用，卸载时自动摘除）。
 */
export function useMaximizeEscape(deps: MaximizeEscapeDeps): void {
  let attached = false

  function onKeydown(event: KeyboardEvent): void {
    if (!isEscape(event) || hasOpenDialog()) {
      return
    }
    // 拦下这次按键：既阻止它走到中栏"中断本轮回答"的冒泡监听，也取消浏览器默认动作
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

  watch(() => deps.active(), (value) => (value ? attach() : detach()), { immediate: true })
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
