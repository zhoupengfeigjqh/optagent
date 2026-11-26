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

export interface InteractionFormContext {
  form: InteractionFormStore
  mention: PathInsertStore | null
  fileIndex: Map<string, { dir: string; file: WorkspaceFile }>
}

export const INTERACTION_FORM_KEY: InjectionKey<InteractionFormContext> = Symbol('interaction-form')

const INVALID_JSON = Symbol('invalid-json')

export interface TopLevelField {
  key: string
  schema: FieldSchema
  required: boolean
}

export interface InteractionFormStore {
  schema: FieldSchema
  model: Ref<Record<string, unknown>>
  topLevel: ComputedRef<TopLevelField[]>
  actionError: Ref<string>
  valueOf(path: NodePath): unknown
  setValue(path: NodePath, value: unknown): void
  isJsonView(path: NodePath, control: ControlKind): boolean
  /** JSON 文本框的显示文本（有草稿用草稿，否则按模型序列化） */
  jsonTextOf(path: NodePath): string
  onJsonInput(path: NodePath, text: string): void
  toggleJsonView(path: NodePath): void
  rulesTarget: ComputedRef<NodePath | null>
  rulesAnchor: ComputedRef<NodePath | null>
  isRulesAnchor(path: NodePath): boolean
  rulesInitialValue(): Array<Record<string, unknown>>
  /** 勾选写回：'' = 成功，否则为可直接展示的错误原因 */
  applyRules(rows: Array<Record<string, unknown>>): string
  loadRules: () => Promise<RuleFileResponse>
  validate(): string
  build(): Record<string, unknown>
  reset(): void
}

export interface InteractionFormDeps {
  schema: Record<string, unknown>
  proposed: Record<string, unknown>
  rulesField?: string | undefined
  loadRules: () => Promise<RuleFileResponse>
}

export function createInteractionForm(deps: InteractionFormDeps): InteractionFormStore {
  const schema = asSchema(deps.schema)
  const model = ref<Record<string, unknown>>({})
  const jsonViews = ref<Set<string>>(new Set())
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

  function fail(message: string): string {
    actionError.value = message
    return message
  }

  function setValue(path: NodePath, value: unknown): void {
    const result = setAtPath(model.value, path, value)
    if (!result.ok) {
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
    if (parsed === INVALID_JSON) return
    setValue(path, parsed)
  }

  function toggleJsonView(path: NodePath): void {
    const key = pathKey(path)
    const views = new Set(jsonViews.value)
    if (views.has(key)) {
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
    return value.filter(
      (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
    )
  }

  function applyRules(rows: Array<Record<string, unknown>>): string {
    const target = rulesTarget.value
    if (target === null) return fail('本工具未声明规则字段，无法写入')
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return INVALID_JSON
  }
}

function cloneJson(value: unknown): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(value ?? {}))
  return typeof cloned === 'object' && cloned !== null && !Array.isArray(cloned)
    ? (cloned as Record<string, unknown>)
    : {}
}
