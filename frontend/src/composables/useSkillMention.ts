/**
 * 输入区 `/技能名`（2026-11-07）
 *
 * 与 `@文件` 同一套「展示层 / 提交层」语义：
 * - **展示层**：正文里落一个 `/技能名` 标记（渲染成不可编辑胶囊，可整枚删除）；
 * - **提交层**：发送时剥离标记，以结构化 `skill` 字段提交（后端据此只插入该技能并跳过聚焦）。
 *
 * 与 `@` 的关键差异是**单选**：一条消息只能指定一个技能，再选即替换。
 *
 * 不变式（与 `useFileMention` 同口径）：
 * - 标记从正文消失 → 选择同步清空；
 * - 选择被移除（点胶囊 x）→ 标记同步消失（由 `useSkillComposer` 落字）；
 * - 拼写只由 `skillToken` 决定，剥离只由 `stripSkillToken` 决定，别处不得再写正则。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import type { AgentsApi } from '../api/agents'
import type { AgentSkill } from '../api/types'
import { useSession } from './useAppSession'

/**
 * `/` 触发检测：行首或空白后的 `/`，其后无空白/斜杠。
 *
 * 前置 `(^|\s)` 是"不误伤"的关键：`11/7`、`和/或`、`a/b` 都不会触发。
 */
export const SKILL_TRIGGER_PATTERN = /(?:^|\s)\/[^\s/]*$/

/** 展示层标记（`/技能名`）。 */
export function skillToken(name: string): string {
  return `/${name}`
}

/**
 * 提交前移除正文中的 `/技能名` 标记。
 *
 * 与 `stripMentionTokens` 同语义：替换为空格并规整空白；结果为空由调用方拦下。
 */
export function stripSkillToken(text: string, skill: string | null): string {
  if (!skill) return text
  return text
    .split(skillToken(skill))
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** 构造参数。 */
export interface SkillMentionDeps {
  agents: AgentsApi
}

/** `/技能名` 状态契约。 */
export interface SkillMentionStore {
  open: Ref<boolean>
  /** 最近一次输入的光标位置（浮层定位读它，收起时归零） */
  caret: Ref<number>
  /** 当前数字人的技能清单（懒加载，切换数字人后失效重拉） */
  skills: Ref<AgentSkill[]>
  loading: Ref<boolean>
  /** 加载失败的用户可读原因；空串 = 正常 */
  error: Ref<string>
  /** `/` 之后的过滤词 */
  query: Ref<string>
  filtered: ComputedRef<AgentSkill[]>
  activeIndex: Ref<number>
  /** 已选技能名；`null` = 未选 */
  selected: Ref<string | null>
  /** 文本/光标变化：检测触发、同步选择 */
  handleInput(text: string, caret: number): void
  /** 外部改写草稿（切换会话、发送后清空）时同步选择，不触发浮层 */
  sync(text: string): void
  /** 拉取技能清单（打开面板时懒加载；失败进 `error`，不阻断输入） */
  load(): Promise<void>
  /** 选择技能：成功返回 `true`（调用方负责落字） */
  pick(name: string): boolean
  move(delta: number): void
  /** 回车确认当前高亮项；返回技能名 */
  confirmActive(): string | null
  close(): void
  /** 取消选择（点胶囊 x） */
  remove(): void
  /** 发送成功 / 切换数字人后清空 */
  reset(): void
}

/** 创建 `/技能名` 状态。 */
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

/** 组件内取用（经 `provide/inject` 的会话上下文）。 */
export function useSkillMention(): SkillMentionStore {
  return useSession().skillMention
}
