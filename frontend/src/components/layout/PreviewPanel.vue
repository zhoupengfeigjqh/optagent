<!--
 * @Author: Nose陈建
 * @LastEditTime: 2026-10-12 19:04:09
-->
<script setup>
// import { toast } from '@/utils/toast'
import FileIcon from './FileIcon.vue'

const props = defineProps({
  file: { type: Object, required: true }
})
const emit = defineEmits(['close'])

// 下载：HTML 文件真实下载（Blob），docx 演示版仅提示
function download() {
  if (props.file.type === 'html') {
    const blob = new Blob([props.file.src], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = props.file.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(a.href)
  } else {
    // toast('实际项目中 .docx 由后端生成，演示版仅支持预览')
  }
}

// 滚动发生在 iframe 文档内部（外层 panel-body 不滚）。
// 嵌入页由后端生成、样式不可控：若其 html/body 自带 overflow:hidden 或
// 100% 高度链，内容超出 iframe 视口也无法滚动。加载后（同源可直接访问）
// 注入兜底样式强制内部可滚。
function ensureInnerScroll(e) {
  const doc = e.target.contentDocument
  if (!doc) return
  const style = doc.createElement('style')
  style.textContent = 'html,body{overflow:auto !important;}'
  doc.head.appendChild(style)
}
</script>

<template>
  <aside class="panel">
    <div class="panel-main">
      <header class="panel-header">
        <div class="panel-title">
          <span class="file-icon small" :class="file.type">
            <FileIcon :type="file.type" :size="16" />
          </span>
          <div>
            <div class="panel-name">{{ file.name }}</div>
            <div class="panel-sub">{{ file.sub }}</div>
          </div>
        </div>
        <div class="panel-actions">
          <button class="panel-btn" title="下载" @click="download">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            <!-- 下载 -->
          </button>
          <button class="panel-btn close" title="关闭面板" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            <!-- 关闭 -->
          </button>
        </div>
      </header>

      <div class="panel-body">
        <iframe style="border: 0;margin: 0; padding: 0; width: 100%; height: 100%;" :src="file.url" :title="file.name" @load="ensureInnerScroll"></iframe>
      </div>
    </div>
  </aside>
</template>
