/**
 * 数字人设计态：加载 / 编辑草稿 / 保存（US1）。
 *
 * 设计要点：
 * - 草稿与已保存态分离：`dirty` 让"未保存就离开"可被提示；
 * - `revision` 为 `null` 表示**新建**（尚无设计态文档），保存时走 POST；
 * - `soul` 为**结构化对象**（004）：与 `scenario.data_prep_fields` 同理，
 *   草稿必须**深拷贝**——否则弹窗里的编辑会直接改到"已保存态"，`dirty` 失效；
 * - 新建态的初值有两个来源（2026-10-09）：空草稿（`resetToNew`）与
 *   「新建数字人」弹窗的结果（`resetToCopy`，含"以既有数字人为模板复制"）。
 */
import { computed, ref, shallowRef } from 'vue'
import type {
  AgentDesign,
  AgentDesignPayload,
  AgentScenario,
  ErrorInfo,
  ScenarioField,
  SoulDesign,
} from '../api/types'
import { createAgent, getAgent, updateAgent } from '../api/agents'
import { PREDEFINED_DATA_PREP_DIRS, emptyScenario, emptySoulDesign } from '../constants/agent-design'
import { toErrorInfo } from '../utils/error-message'

export interface AgentDesignDraft {
  name: string
  soul: SoulDesign
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  scenario: AgentScenario
}

/** 字段约束是"目录 → 字段数组"的两层结构，逐层复制（避免草稿改动污染已保存态） */
function cloneFields(
  fields: Record<string, ScenarioField[]> | undefined,
): Record<string, ScenarioField[]> {
  const out: Record<string, ScenarioField[]> = {}
  for (const [dir, list] of Object.entries(fields ?? {})) {
    out[dir] = list.map((field) => ({ ...field }))
  }
  return out
}

/** 结构化 SOUL 深拷贝（问题实例与工具引用都是嵌套结构，浅拷贝会串改） */
function cloneSoul(soul: SoulDesign): SoulDesign {
  return {
    ...soul,
    capability_tags: [...soul.capability_tags],
    forbidden: [...soul.forbidden],
    starters: soul.starters.map((starter) => ({
      prompt: starter.prompt,
      tools: starter.tools.map((tool) => ({ ...tool })),
    })),
  }
}

export function emptyDraft(): AgentDesignDraft {
  return {
    name: '',
    soul: emptySoulDesign(),
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    scenario: emptyScenario(),
  }
}

function toDraft(design: AgentDesign): AgentDesignDraft {
  return {
    name: design.name,
    soul: cloneSoul(design.soul),
    enabled_tools: [...design.enabled_tools],
    mcp_services: [...design.mcp_services],
    skills: [...design.skills],
    scenario: {
      scenario: design.scenario.scenario,
      data_prep_dirs: [...design.scenario.data_prep_dirs],
      data_prep_fields: cloneFields(design.scenario.data_prep_fields),
    },
  }
}

export function useAgentDesign() {
  const draft = ref<AgentDesignDraft>(emptyDraft())
  const saved = shallowRef<AgentDesign | null>(null)
  const revision = ref<number | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<ErrorInfo | null>(null)

  const isNew = computed(() => revision.value === null)
  const dirty = computed(() => {
    if (isNew.value) {
      return (
        draft.value.name !== '' ||
        // 结构化 SOUL 的"是否有输入"判据：与空结构逐字段比较
        JSON.stringify(draft.value.soul) !== JSON.stringify(emptySoulDesign()) ||
        draft.value.scenario.scenario !== '' ||
        // 预定义目录（算法规则）是新建初值自带的，不算"有输入"
        draft.value.scenario.data_prep_dirs.some(
          (dir) => !(PREDEFINED_DATA_PREP_DIRS as readonly string[]).includes(dir),
        ) ||
        Object.keys(draft.value.scenario.data_prep_fields).length > 0
      )
    }
    const base = saved.value
    if (!base) return true
    return JSON.stringify(toDraft(base)) !== JSON.stringify(draft.value)
  })

  async function load(name: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const design = await getAgent(name)
      saved.value = design
      revision.value = design.revision
      draft.value = toDraft(design)
    } catch (err) {
      error.value = toErrorInfo(err)
      saved.value = null
      revision.value = null
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<AgentDesign | null> {
    saving.value = true
    error.value = null
    try {
      const payload: AgentDesignPayload = {
        ...draft.value,
        soul: cloneSoul(draft.value.soul),
        scenario: { ...draft.value.scenario },
      }
      const result =
        revision.value === null
          ? await createAgent(payload)
          : await updateAgent(saved.value?.name ?? draft.value.name, {
              ...payload,
              revision: revision.value,
            })
      saved.value = result
      revision.value = result.revision
      draft.value = toDraft(result)
      return result
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      saving.value = false
    }
  }

  function resetToNew(): void {
    draft.value = emptyDraft()
    saved.value = null
    revision.value = null
    error.value = null
  }

  /**
   * 新建态的**预填**（2026-10-09：「新建数字人」弹窗的结果，`FR-015`）。
   *
   * - `copyFrom === null`：全部重建，只预填名称；
   * - 否则：以源数字人的**五类配置**为模板复制，名称换成新名称。
   *
   * `revision` 一律保持 `null`——复制出来的是**尚未保存的新建态**，保存必须走 POST
   * （`createAgent`）。这也是不能复用 `saved` / `load()` 的原因：那会把源文档当成
   * "已保存态"，保存时错误地走 PUT，反而去改源数字人。
   *
   * 源在弹窗确认后、设计器挂载前被删（或读取失败）→ **降级为空草稿但保留名称**，
   * 并把可读原因**返回**给调用方去播报（不写 `error`：它的语义是"保存未完成"）。
   */
  async function resetToCopy(name: string, copyFrom: string | null): Promise<string | null> {
    saved.value = null
    revision.value = null
    error.value = null
    if (copyFrom === null) {
      draft.value = { ...emptyDraft(), name }
      return null
    }
    loading.value = true
    try {
      const source = await getAgent(copyFrom)
      draft.value = { ...toDraft(source), name }
      return null
    } catch (err) {
      draft.value = { ...emptyDraft(), name }
      const info = toErrorInfo(err)
      return `无法复制数字人「${copyFrom}」的内容（${info.code}），已改为全新设计（名称保留）。`
    } finally {
      loading.value = false
    }
  }

  return {
    draft,
    saved,
    revision,
    loading,
    saving,
    error,
    isNew,
    dirty,
    load,
    save,
    resetToNew,
    resetToCopy,
  }
}
