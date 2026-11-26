import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { AgentsApi } from '../api/agents'
import type { AgentSkill } from '../api/types'
import { useSession } from './useAppSession'

export const SKILL_TRIGGER_PATTERN = /(?:^|\s)\/[^\s/]*$/

export function skillToken(name: string): string {
  return `/${name}`
}

export function stripSkillToken(text: string, skill: string | null): string {
  if (!skill) return text
  return text
    .split(skillToken(skill))
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

export interface SkillMentionDeps {
  agents: AgentsApi
}

export interface SkillMentionStore {
  open: Ref<boolean>
  caret: Ref<number>
  skills: Ref<AgentSkill[]>
  loading: Ref<boolean>
  error: Ref<string>
  query: Ref<string>
  filtered: ComputedRef<AgentSkill[]>
  activeIndex: Ref<number>
  selected: Ref<string | null>
  handleInput(text: string, caret: number): void
  sync(text: string): void
  load(): Promise<void>
  pick(name: string): boolean
  move(delta: number): void
  confirmActive(): string | null
  close(): void
  remove(): void
  reset(): void
}

export function createSkillMentionStore(deps: SkillMentionDeps): SkillMentionStore {
  const open = ref(false)
  const caret = ref(0)
  const skills = ref<AgentSkill[]>([])
  const loading = ref(false)
  const error = ref('')
  const query = ref('')
  const activeIndex = ref(0)
  const selected = ref<string | null>(null)

  const filtered = computed<AgentSkill[]>(() => {
    const keyword = query.value.trim().toLowerCase()
    if (keyword === '') return skills.value
    return skills.value.filter(
      (skill) =>
        skill.name.toLowerCase().includes(keyword) ||
        skill.description.toLowerCase().includes(keyword),
    )
  })

  function close(): void {
    open.value = false
    caret.value = 0
    query.value = ''
    activeIndex.value = 0
  }

  function sync(text: string): void {
    if (selected.value && !text.includes(skillToken(selected.value))) {
      selected.value = null
    }
  }

  function handleInput(text: string, nextCaret: number): void {
    sync(text)

    const beforeCaret = text.slice(0, Math.max(0, nextCaret))
    if (!SKILL_TRIGGER_PATTERN.test(beforeCaret)) {
      if (open.value) close()
      return
    }

    open.value = true
    caret.value = nextCaret
    query.value = (beforeCaret.match(/\/([^\s/]*)$/)?.[1] ?? '').trim()
    activeIndex.value = 0
    if (skills.value.length === 0 && !loading.value) void load()
  }

  async function load(): Promise<void> {
    if (loading.value) return
    loading.value = true
    error.value = ''
    try {
      const response = await deps.agents.skills()
      skills.value = response.skills
    } catch {
      // 面板降级：提示"加载失败"，输入与发送都不受影响（技能仍可手打，服务端会校验）
      error.value = '技能清单加载失败'
    } finally {
      loading.value = false
    }
  }

  function pick(name: string): boolean {
    if (!skills.value.some((skill) => skill.name === name)) return false
    selected.value = name
    close()
    return true
  }

  function move(delta: number): void {
    const count = filtered.value.length
    if (count <= 0) {
      activeIndex.value = 0
      return
    }
    activeIndex.value = (activeIndex.value + delta + count) % count
  }

  function confirmActive(): string | null {
    return filtered.value[activeIndex.value]?.name ?? null
  }

  function remove(): void {
    selected.value = null
    close()
  }

  function reset(): void {
    selected.value = null
    close()
    // 清单按"当前数字人"作用域返回：切换后必须重拉，避免展示上一个数字人的技能
    skills.value = []
    error.value = ''
  }

  return {
    open,
    caret,
    skills,
    loading,
    error,
    query,
    filtered,
    activeIndex,
    selected,
    handleInput,
    sync,
    load,
    pick,
    move,
    confirmActive,
    close,
    remove,
    reset,
  }
}

export function useSkillMention(): SkillMentionStore {
  return useSession().skillMention
}
