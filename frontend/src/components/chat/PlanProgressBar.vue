<script setup lang="ts">
/**
 * 计划进度条（028 FR-034 / FR-035，方案 B）。
 *
 * 常驻一行、贴在输入区上方：只回答"现在第几步、在干什么、还能不能等"。
 * 默认折叠；展开只列**本轮已经出现过的步骤**（未来步在滚动规划里还不存在），
 * 因此永远不会出现"承诺了 5 步结果只跑 3 步"的失信感。
 *
 * 生命周期：数据只来自 SSE 瞬态，不进历史、不持久化；
 * 本轮结束后淡出 1.5s 移除（`--fading`），下一次发送时由 store 清空。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import type { PlanProgressItem } from '../../composables/useChatStream.types'

const props = withDefaults(
  defineProps<{
    items: PlanProgressItem[]
    /** 本轮是否仍在进行（false = 已收尾，开始淡出倒计时） */
    active?: boolean
  }>(),
  { active: false },
)

const FADE_DELAY_MS = 1500
const FLASH_MS = 220

const listId = 'plan-progress-list'
const open = ref(false)
const hidden = ref(false)
const fading = ref(false)
const flash = ref(false)
let fadeTimer: ReturnType<typeof setTimeout> | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null

/** 当前步：最后一条未完成的；全部完成则取最后一条（用于收尾文案） */
const current = computed<PlanProgressItem | null>(() => {
  const last = props.items[props.items.length - 1]
  if (last === undefined) return null
  const pending = [...props.items].reverse().find((item) => item.phase !== 'done')
  return pending ?? last
})

const replanned = computed(() => current.value?.phase === 'replanned')

function phaseLabel(phase: PlanProgressItem['phase']): string {
  if (phase === 'done') return '已完成'
  if (phase === 'replanned') return '已调整'
  return '进行中'
}

function clearTimers(): void {
  if (fadeTimer !== null) {
    clearTimeout(fadeTimer)
    fadeTimer = null
  }
  if (flashTimer !== null) {
    clearTimeout(flashTimer)
    flashTimer = null
  }
}

watch(
  () => [props.active, props.items.length] as const,
  ([active, length]) => {
    clearTimers()
    if (length === 0) {
      hidden.value = false
      fading.value = false
      return
    }
    if (active) {
      hidden.value = false
      fading.value = false
      return
    }
    // 本轮已收尾：保留 1.5s 让用户看到最后一步，再淡出移除（不写历史）
    fading.value = true
    fadeTimer = setTimeout(() => {
      hidden.value = true
      fading.value = false
    }, FADE_DELAY_MS)
  },
  { immediate: true },
)

// 重规划：数字跳变时闪一次，明确告诉用户"计划变了"（不是进度倒退）
watch(
  replanned,
  (value) => {
    if (!value) return
    flash.value = true
    if (flashTimer !== null) clearTimeout(flashTimer)
    flashTimer = setTimeout(() => {
      flash.value = false
    }, FLASH_MS)
  },
  // 首帧就是 `replanned`（重规划后第一批进度）时也要闪，否则提示只对增量生效
  { immediate: true },
)

onBeforeUnmount(clearTimers)
</script>

<template>
  <section
    v-if="items.length > 0 && !hidden && current"
    class="plan-progress"
    :class="{ 'plan-progress--fading': fading }"
    role="status"
    aria-live="polite"
  >
    <div class="plan-progress__bar" :class="{ 'plan-progress__bar--flash': flash }">
      <span
        class="plan-progress__dot"
        :class="`plan-progress__dot--${current.phase}`"
        aria-hidden="true"
      ></span>
      <span class="plan-progress__text">
        第 {{ current.seqId }} 步 · {{ current.label }}
        <span v-if="replanned" class="plan-progress__note">（计划已调整）</span>
      </span>
      <button
        type="button"
        class="plan-progress__toggle"
        :aria-expanded="open"
        :aria-controls="listId"
        @click="open = !open"
      >
        {{ open ? '收起' : `${items.length} 步` }}
      </button>
    </div>

    <ul v-if="open" :id="listId" class="plan-progress__list" aria-label="本轮已出现的计划步骤">
      <li v-for="item in items" :key="item.seqId" class="plan-progress__item">
        <span class="plan-progress__seq">{{ item.seqId }}</span>
        <span class="plan-progress__label">{{ item.label }}</span>
        <span class="plan-progress__state" :class="`plan-progress__state--${item.phase}`">
          {{ phaseLabel(item.phase) }}
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.plan-progress {
  flex: none;
  margin: 0 var(--space-5) var(--space-2);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  transition: opacity 240ms ease-out;
}

.plan-progress--fading {
  opacity: 0;
}

.plan-progress__bar {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg-subtle);
}

.plan-progress__bar--flash {
  border-color: var(--color-primary);
  background: var(--color-primary-subtle);
}

.plan-progress__dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.plan-progress__dot--running,
.plan-progress__dot--replanned {
  background: var(--color-primary);
}

.plan-progress__dot--done {
  background: var(--color-border-strong);
}

.plan-progress__text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-secondary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-progress__note {
  color: var(--color-primary);
}

.plan-progress__toggle {
  flex: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.plan-progress__toggle:hover {
  color: var(--color-primary);
}

.plan-progress__toggle:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}

.plan-progress__list {
  margin: var(--space-1) 0 0;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  list-style: none;
}

.plan-progress__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 2px 0;
}

.plan-progress__seq {
  flex: none;
  width: 1.2em;
  color: var(--color-text-muted);
  text-align: right;
}

.plan-progress__label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plan-progress__state {
  flex: none;
  color: var(--color-text-muted);
}

.plan-progress__state--done {
  color: var(--color-text-muted);
}

.plan-progress__state--running,
.plan-progress__state--replanned {
  color: var(--color-primary);
}
</style>
