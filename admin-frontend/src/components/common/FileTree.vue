<script setup lang="ts">
/**
 * 通用只读文件树（2026-10-03 由 `skills/SkillFileTree` 抽取为共用件）。
 *
 * 两处在用，形态必须一致（这是抽取的原因）：
 * - SKILL 详情：`SKILL.md` + `references/` 等整包文件（选中后可编辑）；
 * - 本体详情：`ontology.yaml` + `securities.yaml`（根层两个文件，选中后**只读**）。
 *
 * 口径：
 * - 层级按路径的 `/` 拆分展示，目录可折叠；
 * - 每一项都是**原生按钮**（键盘可达、焦点可见），当前项标 `aria-current`；
 * - 只负责"选哪个文件"，不负责读内容（读由父组件完成）。
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

const props = withDefaults(
  defineProps<{
    files: Array<{ path: string; size: number }>
    /** 当前选中的文件路径 */
    selected: string
    /** 无障碍标签（`nav` 的 `aria-label`），如「技能文件」「本体文件」 */
    label?: string
  }>(),
  { label: '文件' },
)

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
