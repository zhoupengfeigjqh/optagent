import { matchKeys } from '../ontology-doc.js';
import type { BehaviorLookup } from '../rule-gate/types.js';
import type { CheckFailure, PlanStep, RawStep, StepType } from './types.js';

export type ToolNameIndex = ReadonlyMap<string, readonly string[]>;

export interface OntologyFacts {
  relatedConceptsOf(functionName: string): readonly string[];
  ontologyKeysOfFunction(functionName: string): readonly string[];
  queryBehaviorsOf(conceptName: string, ontologyKey?: string): readonly string[];
}

export interface NormalizeDeps {
  nameIndex: ToolNameIndex;
  behaviorOf(toolName: string): BehaviorLookup | null;
  facts: OntologyFacts;
  nextSeqId(): number;
}

/** 归一化结果：成功步骤 + 不可补全项 */
export interface NormalizeResult {
  steps: PlanStep[];
  failures: CheckFailure[];
}

/**
 * 由本轮工具数组构建「派生键 → 原样工具名[]」索引。
 *
 * @param tools 必须是**已包装**的工具数组（`guarded`），它们的 `name` 才是模型可见的真名
 */
export function buildToolNameIndex(tools: readonly { name: string }[]): ToolNameIndex {
  const index = new Map<string, string[]>();
  for (const tool of tools) {
    for (const key of matchKeys(tool.name)) {
      const bucket = index.get(key);
      if (bucket === undefined) index.set(key, [tool.name]);
      else if (!bucket.includes(tool.name)) bucket.push(tool.name);
    }
  }
  return index;
}

export function resolveToolNames(name: string, index: ToolNameIndex): string[] {
  const found: string[] = [];
  for (const key of matchKeys(name)) {
    for (const candidate of index.get(key) ?? []) {
      if (!found.includes(candidate)) found.push(candidate);
    }
  }
  return found;
}

export function normalizePlan(raw: readonly RawStep[], deps: NormalizeDeps): NormalizeResult {
  const steps: PlanStep[] = [];
  const failures: CheckFailure[] = [];

  raw.forEach((item, position) => {
    const seqId = position + 1;
    const label = item.coreAction.trim();
    const candidates = resolveToolNames(label, deps.nameIndex);

    if (candidates.length !== 1) {
      failures.push({
        code: 'C0',
        seqId,
        field: 'coreAction',
        detail:
          candidates.length === 0
            ? `coreAction「${label}」在本轮可用工具中找不到对应工具`
            : `coreAction「${label}」对应 ${candidates.length} 个工具（${candidates.join('、')}），无法唯一确定`,
      });
      return;
    }

    const coreAction = candidates[0] as string;
    const behavior = deps.behaviorOf(coreAction);
    const type = deriveType(behavior);

    const derived = deriveDependTools({
      type,
      label,
      self: coreAction,
      behavior,
      facts: deps.facts,
      nameIndex: deps.nameIndex,
    });
    if (derived.missing.length > 0) {
      failures.push({
        code: 'C3',
        seqId,
        field: 'dependTools',
        detail: `依赖的工具在本轮不可用：${derived.missing.join('、')}`,
      });
      return;
    }

    steps.push({
      seqId: deps.nextSeqId(),
      taskName: item.taskName.trim(),
      content: item.content.trim(),
      coreActionLabel: label,
      coreAction,
      type,
      dependTools: derived.tools,
      status: 'pending',
      coreActionOk: false,
      attempts: 0,
      lastCoreActionTurn: -1,
      retryableStreak: 0,
    });
  });

  return { steps, failures };
}

function deriveType(behavior: BehaviorLookup | null): StepType {
  if (behavior === null) return 'function';
  return behavior.command ? 'command' : 'query';
}

interface DeriveInput {
  type: StepType;
  label: string;
  self: string;
  behavior: BehaviorLookup | null;
  facts: OntologyFacts;
  nameIndex: ToolNameIndex;
}

interface DerivedDepend {
  tools: string[];
  missing: string[];
}

function deriveDependTools(input: DeriveInput): DerivedDepend {
  const tools: string[] = [];
  const missing: string[] = [];
  if (input.type === 'query') return { tools, missing };

  const push = (name: string): void => {
    const resolved = resolveToolNames(name, input.nameIndex);
    if (resolved.length !== 1) {
      if (!missing.includes(name)) missing.push(name);
      return;
    }
    const tool = resolved[0] as string;
    if (tool === input.self) return;
    if (!tools.includes(tool)) tools.push(tool);
  };

  const related: Array<{ concept: string; ontologyKey?: string }> = [];

  if (input.type === 'command') {
    const functions = input.behavior?.relatedFunctions ?? [];
    const ontologyKey = input.behavior?.ref.ontologyKey;
    for (const fn of functions) {
      push(fn);
      for (const concept of input.facts.relatedConceptsOf(fn)) {
        related.push(ontologyKey === undefined ? { concept } : { concept, ontologyKey });
      }
    }
  } else {
    const keys = input.facts.ontologyKeysOfFunction(input.label);
    for (const concept of input.facts.relatedConceptsOf(input.label)) {
      if (keys.length === 0) related.push({ concept });
      else for (const key of keys) related.push({ concept, ontologyKey: key });
    }
  }

  for (const item of related) {
    for (const behavior of input.facts.queryBehaviorsOf(item.concept, item.ontologyKey)) {
      push(behavior);
    }
  }

  return { tools, missing };
}
