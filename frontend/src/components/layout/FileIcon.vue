<script setup>
// 文件类型图标（内联 SVG，风格统一）
defineProps({
  type: { type: String, required: true },
  size: { type: Number, default: 18 }
})
</script>

<template>
  <svg
    v-if="type === 'html'"
    :width="size" :height="size" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  >
    <path d="M9 8l-4 4 4 4" />
    <path d="M15 8l4 4-4 4" />
  </svg>
  <svg
    v-else
    :width="size" :height="size" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
</template>
