<script setup lang="ts">
import { computed, ref } from 'vue'

interface FileNode {
  path: string
  label: string
  depth: number
  dir: string
}

const props = withDefaults(
  defineProps<{
    files: Array<{ path: string; size: number }>
    selected: string
    label?: string
  }>(),
  { label: '文件' },
)

const emit = defineEmits<{
  (e: 'select', path: string): void
}>()

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
  <nav class="file-tree" :aria-label="props.label">
    <ul class="file-tree__list">
      <li v-for="row in rows" :key="'isDir' in row ? `d:${row.dir}` : `f:${row.path}`">
        <template v-if="'isDir' in row">
          <button
            type="button"
            class="file-tree__dir"
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
          class="file-tree__file"
          :class="{ 'file-tree__file--active': row.path === props.selected }"
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
.file-tree {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-2);
  background: var(--color-bg-subtle);
}

.file-tree__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.file-tree__dir,
.file-tree__file {
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

.file-tree__dir {
  color: var(--color-text-secondary);
}

.file-tree__file--active {
  background: var(--color-bg-muted);
  font-weight: 600;
}
</style>
