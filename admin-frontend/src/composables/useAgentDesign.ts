/**
 * 数字人设计态：加载 / 编辑草稿 / 保存（US1）。
 *
 * 设计要点：
 * - 草稿与已保存态分离：`dirty` 让"未保存就离开"可被提示；
 * - `revision` 为 `null` 表示**新建**（尚无设计态文档），保存时走 POST；
 * - `soul` 等字符串字段**不做 trim**——`FR-017` 要求原样回显含换行与标点。
 */
import { computed, ref, shallowRef } from 'vue'
import type { AgentDesign, AgentDesignPayload, AgentScenario, ScenarioField } from '../api/types'
import { createAgent, getAgent, updateAgent } from '../api/agents'
import { PREDEFINED_DATA_PREP_DIRS } from '../constants/agent-design'
import { emptyScenario } from '../constants/agent-design'
import { toErrorInfo } from '../utils/error-message'
import type { ErrorInfo } from '../api/types'

export interface AgentDesignDraft {
  name: string
  soul: string
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

export function emptyDraft(): AgentDesignDraft {
  return {
    name: '',
    soul: '',
    enabled_tools: [],
    mcp_services: [],
    skills: [],
    scenario: emptyScenario(),
  }
}

function toDraft(design: AgentDesign): AgentDesignDraft {
  return {
    name: design.name,
    soul: design.soul,
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
        draft.value.soul !== '' ||
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
      const payload: AgentDesignPayload = { ...draft.value, scenario: { ...draft.value.scenario } }
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

  return { draft, saved, revision, loading, saving, error, isNew, dirty, load, save, resetToNew }
}
