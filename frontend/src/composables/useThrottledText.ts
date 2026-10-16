/**
 * 把高频变化的文本**按时间窗合并**之后再给界面用（2026-10-16）。
 *
 * 背景：流式回答每收到一个 token 就往累积文本上 `+=` 一次（`useChatStream`），一段两千字
 * 的回答就是几千次响应式更新——每次都要重建文本节点、改变 `scrollHeight`、再跟一次置底
 * 滚动，表现为长回答时的卡顿与滚动抖动。
 *
 * 分工：**状态本身保持逐 token 精确**（`useChatStream` 一行不改，中断/重试/落盘语义与
 * 它的测试都不受影响），被节流的只是"给渲染看的那一份"。
 *
 * 三个刻意的取舍：
 * 1. 用 `setTimeout` 而不是 `requestAnimationFrame`：后者在后台标签页会被暂停，回到前台
 *    时那一帧要一次性补上全部内容；定时器方案前后台一致，也能被 `vi.useFakeTimers`
 *    精确断言（可测性优先）。
 * 2. **尾帧合并**：首个变化开一个窗口，窗口内后续变化并成同一次更新，最坏延迟即窗口长度。
 *    不做"首帧立即更新"是因为 token 往往在同一毫秒内成批到达，前沿更新几乎总是白做。
 * 3. **文本变短 = 复位**（发送新一轮会把累积文本清空）时立即落定：否则上一轮的正文会在
 *    新一轮的气泡里闪现一个窗口。
 */
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 合并窗口：50ms ≈ 20 次/秒，顺滑够用，也足够省 */
export const STREAM_TEXT_INTERVAL_MS = 50

/**
 * @param source 逐 token 精确的累积文本（只读，状态源）
 * @returns 供渲染使用的影子文本：内容与 `source` 一致，但更新被合并到时间窗粒度
 */
export function useThrottledText(source: Readonly<Ref<string>>): Ref<string> {
  const view = ref(source.value)
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush(): void {
    timer = null
    view.value = source.value
  }

  watch(
    () => source.value,
    (value) => {
      // 复位：立刻对齐，不让上一轮的内容在新气泡里闪一下
      if (value.length < view.value.length) {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        view.value = value
        return
      }
      // 已有待落的尾帧：本次变化并进去即可
      if (timer !== null) return
      timer = setTimeout(flush, STREAM_TEXT_INTERVAL_MS)
    },
  )

  onBeforeUnmount(() => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  })

  return view
}
