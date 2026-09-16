<script setup lang="ts">
/**
 * 技能文件树（只读导航，2026-09-16）。
 *
 * - 层级按路径的 `/` 拆分展示，目录可折叠；
 * - 每一项都是**原生按钮**（键盘可达、焦点可见），当前项标 `aria-current`；
 * - 只负责"选哪个文件"，不负责读内容（读由父组件经只读端点完成）。
 */
import { computed, ref } from 'vue'

interface FileNode {
  /** 文件相对路径（库内口径，posix） */
  path: string
  /** 展示名（末段） */
  label: string
  depth: number
  dir: string
}

const props = defineProps<{
  files: Array<{ path: string; size: number }>
  /** 当前选中的文件路径 */
  selected: string
}>()

const emit = defineEmits<{
  (e: 'select', path: string): void
}>()

/** 折叠的目录前缀集合（默认全展开） */
const collapsed = ref<Set<string>>(new Set())

/** 扁平化成"目录行 + 文件行"，目录行不可选中，仅用于折叠 */
const rows = computed<Array<FileNode | { dir: string; label: string; depth: number; isDir: true }>>(
  () => {
    const out: Array<FileNode | { dir: string; label: string; depth: number; isDir: true }> = []
    const seenDirs = new Set<string>()
    for (const file of props.files) {
      const segments = file.path.split('/')
      const fileName = segments.pop() ?? file.path
      let prefix = ''
      let hidden = false
      for (let i = 0; i < segments.length; i += 1) {
        prefix = prefix ? `${prefix}/${segments[i]}` : segments[i]!
        if (!seenDirs.has(prefix)) {
          seenDirs.add(prefix)
          out.push({ dir: prefix, label: segments[i]!, depth: i, isDir: true })
        }
        if (collapsed.value.has(prefix)) hidden = true
      }
      if (hidden) continue
      out.push({
        path: file.path,
        label: fileName,
        depth: segments.length,
        dir: segments.join('/'),
      })
    }
    return out
  },
)

function toggle(dir: string): void {
  const next = new Set(collapsed.value)
  if (next.has(dir)) next.delete(dir)
  else next.add(dir)
  collapsed.value = next
}

function isCollapsed(dir: string): boolean {
  return collapsed.value.has(dir)
}
</script>

<template>
  <nav class="skill-file-tree" aria-label="技能文件">
    <ul class="skill-file-tree__list">
      <li v-for="row in rows" :key="'isDir' in row ? `d:${row.dir}` : `f:${row.path}`">
        <template v-if="'isDir' in row">
          <button
            type="button"
            class="skill-file-tree__dir"
            :style="{ paddingLeft: `${row.depth * 12 + 4}px` }"
            :aria-expanded="!isCollapsed(row.dir)"
            @click="toggle(row.dir)"
          >
            <span aria-hidden="true">{{ isCollapsed(row.dir) ? '▸' : '▾' }}</span>
            {{ row.label }}/
          </button>
        </template>
        <button
          v-else
          type="button"
          class="skill-file-tree__file"
          :class="{ 'skill-file-tree__file--active': row.path === props.selected }"
          :style="{ paddingLeft: `${row.depth * 12 + 16}px` }"
          :aria-current="row.path === props.selected ? 'true' : undefined"
          @click="emit('select', row.path)"
        >
          {{ row.label }}
        </button>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.skill-file-tree {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  background: var(--color-bg-subtle);
}

.skill-file-tree__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.skill-file-tree__dir,
.skill-file-tree__file {
  display: block;
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  text-align: left;
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.skill-file-tree__dir {
  color: var(--color-text-secondary);
}

.skill-file-tree__file--active {
  background: var(--color-bg-muted);
  font-weight: 600;
}
</style>
