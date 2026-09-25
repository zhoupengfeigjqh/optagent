<script setup lang="ts">
/**
 * 内联 SVG 图标（T024）
 *
 * 不引入任何图标库，路径表内置在组件内，保持"零框架外依赖"。
 * 无障碍：`label` 为空时对读屏隐藏；非空时以 `img` 角色暴露名称。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 图标名（见 `ICON_PATHS`） */
    name: string
    /** 边长（px），默认 16 */
    size?: number
    /** 无障碍名称；为空表示纯装饰 */
    label?: string | null
  }>(),
  { size: 16, label: null },
)

/** 图标路径表：值为 `<path>` 的 `d` 列表（24×24 视图框，描边风格）。 */
const ICON_PATHS: Readonly<Record<string, readonly string[]>> = {
  plus: ['M12 5v14', 'M5 12h14'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  check: ['M20 6 9 17l-5-5'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
  stop: ['M6 6h12v12H6z'],
  copy: [
    'M8 8h11v11H8z',
    'M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3',
  ],
  'chevron-down': ['m6 9 6 6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'thumb-up': [
    'M7 10v12',
    'M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z',
  ],
  'thumb-down': [
    'M17 14V2',
    'M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z',
  ],
  folder: ['M4 20h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-8l-2-2H4a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1Z'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z', 'M14 2v6h6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm7 10 5 5 5-5', 'M12 15V3'],
  upload: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'm17 8-5-5-5 5', 'M12 3v12'],
  more: [
    'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
    'M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  ],
  agent: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 21a8 8 0 0 1 16 0'],
  workspace: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z'],
  alert: [
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z',
    'M12 9v4',
    'M12 17h.01',
  ],
  info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 16v-4', 'M12 8h.01'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7L21 8', 'M21 3v5h-5'],
  trash: [
    'M3 6h18',
    'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2',
    'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6',
  ],
  edit: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z'],
  bell: ['M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9', 'M13.73 21a2 2 0 0 1-3.46 0'],
}

const paths = computed<readonly string[]>(() => ICON_PATHS[props.name] ?? [])
const labelled = computed(() => (props.label ?? '').trim() !== '')
</script>

<template>
  <svg
    class="base-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    :aria-hidden="labelled ? undefined : 'true'"
    :role="labelled ? 'img' : undefined"
    :aria-label="labelled ? (label ?? undefined) : undefined"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>

<style scoped>
.base-icon {
  display: inline-block;
  flex: none;
  vertical-align: middle;
}
</style>
