/**
 * HITL 弹窗表单状态（2026-09-23）。
 *
 * 职责：把"入参 schema + 预填值 + 规则字段声明"变成一份可递归渲染、可校验、可提交的**模型**。
 * 组件只消费这里的状态与结论，自身不含控件推导（推导在 `utils/arg-schema.ts`）。
 *
 * 三个关键设计：
 * - **模型是唯一事实源**：入参是一棵结构化值树，每个控件按自己的路径读写（`valueOf`/`setValue`），
 *   不再有"JSON 文本 + 逐字段并行 ref"的多源同步难题；
 * - **JSON 逃生舱**：schema 表达不了的形状（自由对象、数组套数组）与用户主动切换的节点用 JSON
 *   文本编辑。文本只是**草稿**，能解析才写进模型——非法 JSON 因此不会污染模型，也不会静默
 *   丢掉用户已经填好的其它字段；
 * - **规则入口落点**：`rules_field` 解析成"能结构化渲染到的最长前缀"（`rulesAnchorOf`），
 *   写回始终按**完整路径**深写进模型（不再往 JSON 文本里塞字符串）。
 */
import { computed, ref, type ComputedRef, type InjectionKey, type Ref } from 'vue'

import type { RuleFileResponse, WorkspaceFile } from '../api/types'
import {
  asSchema,
  propertiesOf,
  requiredSetOf,
  rulesAnchorOf,
  type ControlKind,
  type FieldSchema,
} from '../utils/arg-schema'
import { buildArgs, pickKnownKeys, validateArgs } from '../utils/arg-values'
import { formatPath, pathKey, readAtPath, setAtPath, type NodePath } from '../utils/json-path'
import type { PathInsertStore } from './usePathInsert'

/** 递归字段组件的注入契约：整棵组件树共享同一份表单状态与展示数据源。 */
export interface InteractionFormContext {
  form: InteractionFormStore
  /** `@` 路径插入状态（无会话上下文时为 null，弹窗退化为纯表单） */
  mention: PathInsertStore | null
  /** 文件空间反查（结构化卡片的数据源：user-data 相对路径 → 文件） */
  fileIndex: Map<string, { dir: string; file: WorkspaceFile }>
}

/** 注入键。定义在此以免多出一份纯常量模块。 */
export const INTERACTION_FORM_KEY: InjectionKey<InteractionFormContext> =
  Symbol('interaction-form')

/** 非法 JSON 的哨兵（不用 null：`null` 是合法 JSON 值）。 */
const INVALID_JSON = Symbol('invalid-json')

/** 顶层字段（模板遍历用）。 */
export interface TopLevelField {
  key: string
  schema: FieldSchema
  required: boolean
}

export interface InteractionFormStore {
  schema: FieldSchema
  /** 结构化值树（唯一事实源） */
  model: Ref<Record<string, unknown>>
  topLevel: ComputedRef<TopLevelField[]>
  /** 最近一次**操作**的失败原因（结构冲突、规则写回被拒）——不静默吞掉 */
  actionError: Ref<string>
  valueOf(path: NodePath): unknown
  setValue(path: NodePath, value: unknown): void
  /** 该节点是否以 JSON 文本框呈现（schema 决定的逃生舱，或用户手动切换） */
  isJsonView(path: NodePath, control: ControlKind): boolean
  /** JSON 文本框的显示文本（有草稿用草稿，否则按模型序列化） */
  jsonTextOf(path: NodePath): string
  onJsonInput(path: NodePath, text: string): void
  toggleJsonView(path: NodePath): void
  /** 规则入口：完整目标路径与落点（无声明 → null） */
  rulesTarget: ComputedRef<NodePath | null>
  rulesAnchor: ComputedRef<NodePath | null>
  /** 该路径是否是规则入口落点（控件据此渲染入口） */
  isRulesAnchor(path: NodePath): boolean
  /** 已勾选规则的回填值（反勾用当前模型值，而非预填快照） */
  rulesInitialValue(): Array<Record<string, unknown>>
  /** 勾选写回：'' = 成功，否则为可直接展示的错误原因 */
  applyRules(rows: Array<Record<string, unknown>>): string
  /** 规则数据加载器（透传给选择器） */
  loadRules: () => Promise<RuleFileResponse>
  /** 本地校验：'' = 通过 */
  validate(): string
  /** 提交构建：剪枝 + 类型收敛后的 args */
  build(): Record<string, unknown>
  /** 换挂起点 / 重开弹窗时重置（回到预填值并丢掉全部草稿） */
  reset(): void
}

/** 构造参数。 */
export interface InteractionFormDeps {
  /** 工具入参 schema（快照原样） */
  schema: Record<string, unknown>
  /** 模型提议值（预填） */
  proposed: Record<string, unknown>
  /** 快照声明的规则字段路径（对象路径，如 `input.targetPriorities`） */
  rulesField?: string | undefined
  /** 规则数据加载器（会话环境注入；单测可桩） */
  loadRules: () => Promise<RuleFileResponse>
}

/** 创建表单状态（组件级；随弹窗实例生命周期）。 */
export function createInteractionForm(deps: InteractionFormDeps): InteractionFormStore {
  const schema = asSchema(deps.schema)
  const model = ref<Record<string, unknown>>({})
  /** 用户主动切到 JSON 的节点（schema 决定的逃生舱节点不在此列，它们天然是 JSON） */
  const jsonViews = ref<Set<string>>(new Set())
  /** JSON 编辑草稿（仅在"文本不等于模型序列化结果"时有意义） */
  const jsonDrafts = ref<Record<string, string>>({})
  const actionError = ref('')

  const topLevel = computed<TopLevelField[]>(() => {
    const required = requiredSetOf(schema)
    return propertiesOf(schema).map(({ key, schema: child }) => ({
      key,
      schema: child,
      required: required.has(key),
    }))
  })

  const rulesTarget = computed<NodePath | null>(() => {
    const raw = deps.rulesField?.trim() ?? ''
    if (raw === '') return null
    const segments = raw.split('.').filter((segment) => segment !== '')
    return segments.length > 0 ? segments : null
  })

  const rulesAnchor = computed<NodePath | null>(() => {
    const target = rulesTarget.value
    if (target === null) return null
    const { anchor } = rulesAnchorOf(schema, target)
    return anchor.length > 0 ? anchor : null
  })

  function valueOf(path: NodePath): unknown {
    return readAtPath(model.value, path)
  }

  /** 记录并返回一次操作失败的原因（组件展示、测试断言都拿得到，不静默）。 */
  function fail(message: string): string {
    actionError.value = message
    return message
  }

  function setValue(path: NodePath, value: unknown): void {
    const result = setAtPath(model.value, path, value)
    if (!result.ok) {
      // 结构冲突（目标位置的容器已被改成别的类型）：说清楚，不假装写成功
      fail(result.error)
      return
    }
    model.value = result.value as Record<string, unknown>
    actionError.value = ''
  }

  function isJsonView(path: NodePath, control: ControlKind): boolean {
    return control === 'json' || jsonViews.value.has(pathKey(path))
  }

  function jsonTextOf(path: NodePath): string {
    const draft = jsonDrafts.value[pathKey(path)]
    if (draft !== undefined) return draft
    const value = valueOf(path)
    return value === undefined ? '' : JSON.stringify(value, null, 2)
  }

  function onJsonInput(path: NodePath, text: string): void {
    jsonDrafts.value = { ...jsonDrafts.value, [pathKey(path)]: text }
    if (text.trim() === '') return
    const parsed = parseJson(text)
    // 非法文本只留在草稿里等用户修正：模型保持最后一次成功解析的值
    if (parsed === INVALID_JSON) return
    setValue(path, parsed)
  }

  function toggleJsonView(path: NodePath): void {
    const key = pathKey(path)
    const views = new Set(jsonViews.value)
    if (views.has(key)) {
      // 退出 JSON 视图：丢掉草稿，模型里已是最后一次成功解析的值
      views.delete(key)
      const drafts = { ...jsonDrafts.value }
      delete drafts[key]
      jsonDrafts.value = drafts
    } else {
      views.add(key)
    }
    jsonViews.value = views
  }

  function isRulesAnchor(path: NodePath): boolean {
    const anchor = rulesAnchor.value
    return anchor !== null && pathKey(anchor) === pathKey(path)
  }

  function rulesInitialValue(): Array<Record<string, unknown>> {
    const target = rulesTarget.value
    if (target === null) return []
    const value = valueOf(target)
    if (!Array.isArray(value)) return []
    return value.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
  }

  function applyRules(rows: Array<Record<string, unknown>>): string {
    const target = rulesTarget.value
    if (target === null) return fail('本工具未声明规则字段，无法写入')
    // 目标路径上任何一层处于 JSON 编辑态且文本非法时先拒绝：宁可让用户先修正，
    // 也不要把他的文本覆盖掉（与"不静默覆盖"同一口径）
    for (let depth = 1; depth <= target.length; depth += 1) {
      const prefix = target.slice(0, depth)
      const text = jsonDrafts.value[pathKey(prefix)]
      if (text === undefined || text.trim() === '') continue
      if (parseJson(text) === INVALID_JSON) {
        return fail(`参数「${formatPath(prefix)}」当前不是合法 JSON，请先修正后再选择规则`)
      }
    }
    const result = setAtPath(model.value, target, rows)
    if (!result.ok) return fail(result.error)
    model.value = result.value as Record<string, unknown>
    actionError.value = ''
    // 目标及其祖先的 JSON 草稿按新模型重新序列化（删掉草稿即回到"从模型序列化"）
    const drafts = { ...jsonDrafts.value }
    for (let depth = 1; depth <= target.length; depth += 1) {
      delete drafts[pathKey(target.slice(0, depth))]
    }
    jsonDrafts.value = drafts
    return ''
  }

  function validate(): string {
    const draftError = validateJsonDrafts()
    if (draftError !== '') return draftError
    return validateArgs(schema, model.value)
  }

  /**
   * JSON 草稿校验：草稿只在节点**当前以 JSON 呈现**时才存在（切回表单时已随视图丢弃，
   * 表格单元格退化成 JSON 框时也走同一套草稿），因此逐个校验即可，无需再判断视图归属。
   */
  function validateJsonDrafts(): string {
    for (const [key, text] of Object.entries(jsonDrafts.value)) {
      if (text.trim() === '') continue
      if (parseJson(text) === INVALID_JSON) {
        return `参数「${formatPath(JSON.parse(key) as NodePath)}」不是合法 JSON`
      }
    }
    return ''
  }

  function build(): Record<string, unknown> {
    return buildArgs(schema, model.value)
  }

  function reset(): void {
    model.value = pickKnownKeys(schema, cloneJson(deps.proposed))
    jsonViews.value = new Set()
    jsonDrafts.value = {}
    actionError.value = ''
  }

  reset()

  return {
    schema,
    model,
    topLevel,
    actionError,
    valueOf,
    setValue,
    isJsonView,
    jsonTextOf,
    onJsonInput,
    toggleJsonView,
    rulesTarget,
    rulesAnchor,
    isRulesAnchor,
    rulesInitialValue,
    applyRules,
    loadRules: deps.loadRules,
    validate,
    build,
    reset,
  }
}

/** 解析 JSON 文本：失败返回哨兵。 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return INVALID_JSON
  }
}

/** 深拷贝（只处理 JSON 值；预填值来自服务端 JSON，不含函数/Date）。 */
function cloneJson(value: unknown): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(value ?? {}))
  return typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)
    ? (cloned as Record<string, unknown>)
    : {}
}

