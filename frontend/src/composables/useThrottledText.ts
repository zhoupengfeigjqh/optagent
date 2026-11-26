import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

export const STREAM_TEXT_INTERVAL_MS = 50

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
      if (value.length < view.value.length) {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        view.value = value
        return
      }
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
