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
import {
  PREDEFINED_DATA_PREP_DIRS,
  SOUL_LIMITS,
  emptyScenario,
  emptySoulDesign,
} from '../constants/agent-design'
import { toErrorInfo } from '../utils/error-message'

export interface AgentDesignDraft {
  name: string
  soul: SoulDesign
  enabled_tools: string[]
  mcp_services: string[]
  skills: string[]
  ontologies: string[]
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

/** 目录级可上传类型也是"目录 → 数组"的两层结构，逐层复制（避免草稿改动污染已保存态） */
function cloneUploads(uploads: Record<string, string[]> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [dir, list] of Object.entries(uploads ?? {})) {
    out[dir] = [...list]
  }
  return out
}

const PREDEFINED_DIRS = PREDEFINED_DATA_PREP_DIRS as readonly string[]

function hasScenarioDirChanged(dirs: readonly string[]): boolean {
  return (
    dirs.some((dir) => !PREDEFINED_DIRS.includes(dir)) ||
    PREDEFINED_DIRS.some((dir) => !dirs.includes(dir))
  )
}

function cloneSoul(soul: SoulDesign): SoulDesign {
  return {
    ...soul,
    next_action_hints: soul.next_action_hints === true,
    // 缺省兜底：接口应当恒有该键，旧存档万一没有也不至于让输入框显示 `undefined`
    next_action_hints_count: soul.next_action_hints_count ?? SOUL_LIMITS.nextActionHintsDefault,
    intent_focus: soul.intent_focus === true,
    // 027：两个新开关也必须显式列出，否则"复制数字人"会整片丢字段（007/013 踩过同一个坑）
    input_rewrite: soul.input_rewrite === true,
    term_normalize: soul.term_normalize === true,
    // 028：显式列出，避免"复制数字人"丢字段
    task_planning: soul.task_planning === true,
    // 019：阶数显式兜底（接口恒有该键，旧存档万一没有也不至于把控件搞成未选中）
    intent_focus_depth: soul.intent_focus_depth ?? SOUL_LIMITS.focusDepthDefault,
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
    ontologies: [],
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
    ontologies: [...design.ontologies],
    scenario: {
      scenario: design.scenario.scenario,
      data_prep_dirs: [...design.scenario.data_prep_dirs],
      data_prep_fields: cloneFields(design.scenario.data_prep_fields),
      data_prep_uploads: cloneUploads(design.scenario.data_prep_uploads),
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
        JSON.stringify(draft.value.soul) !== JSON.stringify(emptySoulDesign()) ||
        draft.value.scenario.scenario !== '' ||
        hasScenarioDirChanged(draft.value.scenario.data_prep_dirs) ||
        Object.keys(draft.value.scenario.data_prep_fields).length > 0 ||
        Object.keys(draft.value.scenario.data_prep_uploads ?? {}).length > 0
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
        scenario: {
          ...draft.value.scenario,
          data_prep_uploads: cloneUploads(draft.value.scenario.data_prep_uploads),
        },
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
