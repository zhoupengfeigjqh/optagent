/**
 * 计划归一化（028 FR-007/FR-007a/FR-008/FR-009/FR-010）。
 *
 * 职责：把 LLM 的裸名计划补全为**可执行计划**，且**只补全、不判定**。
 * 无法补全的项以 `CheckFailure` 返回，交给 `checkPlan` 统一裁决。
 *
 * 三段名字口径（混用会导致「工具全部不可见」的静默故障）：
 * 1. 裸名（`QueryInventory`）：LLM 输出与展示；
 * 2. 完整工具名（`rawmcp__QueryInventory`，原样大小写）：`coreAction` 与 `dependTools`；
 * 3. 派生键（小写、可去前缀）：只用于查集合，**不落库、不进 `coreAction`**。
 *
 * `availableNames` 只含派生键且不携带原样名，因此本模块必须现场维护
 * 「派生键 → 原样工具名[]」映射（由 `guarded` 数组构建），否则拿不回真实工具名。
 */
import { matchKeys } from '../ontology-doc.js';
import type { BehaviorLookup } from '../rule-gate/types.js';
import type { CheckFailure, PlanStep, RawStep, StepType } from './types.js';

/** 派生键 → 原样工具名[]（同一个键可能对应多个服务的同名工具） */
export type ToolNameIndex = ReadonlyMap<string, readonly string[]>;

/** `dependTools` 推导所需的本体事实（由 `ontology-facts.ts` 实现） */
export interface OntologyFacts {
  /** 归一函数名 → 关联概念名（原样） */
  relatedConceptsOf(functionName: string): readonly string[];
  /** 归一函数名 → 所属本体键（可能多个；未知返回空数组） */
  ontologyKeysOfFunction(functionName: string): readonly string[];
  /** 概念名（+ 可选本体限定）→ 该概念的 query 行为裸名[] */
  queryBehaviorsOf(conceptName: string, ontologyKey?: string): readonly string[];
}

/** 归一化依赖（全部只读，便于测试替身） */
export interface NormalizeDeps {
  /** 本轮全部工具（原样名）构建的派生键索引 */
  nameIndex: ToolNameIndex;
  /** 规则闸门只读查询；不是本体行为返回 null */
  behaviorOf(toolName: string): BehaviorLookup | null;
  facts: OntologyFacts;
  /** 分配 `seqId`（run 级自增，跨批连续） */
  nextSeqId(): number;
}

/** 归一化结果：成功步骤 + 不可补全项 */
export interface NormalizeResult {
  steps: PlanStep[];
  /** C0（coreAction 无法唯一解析）/ C3（依赖解析不到） */
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

/** 裸名 / 完整名 / 派生键 → 候选原样工具名（去重、保序） */
export function resolveToolNames(name: string, index: ToolNameIndex): string[] {
  const found: string[] = [];
  for (const key of matchKeys(name)) {
    for (const candidate of index.get(key) ?? []) {
      if (!found.includes(candidate)) found.push(candidate);
    }
  }
  return found;
}

/** 归一化整批计划 */
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

/** `type` 由后端推导：命中且 command → command；命中且非 command → query；未命中 → function */
function deriveType(behavior: BehaviorLookup | null): StepType {
  if (behavior === null) return 'function';
  return behavior.command ? 'command' : 'query';
}

interface DeriveInput {
  type: StepType;
  /** LLM 给出的裸名（本体函数查关联概念时用） */
  label: string;
  /** 本步 `coreAction` 的完整名（用于从依赖集合里排除自身） */
  self: string;
  behavior: BehaviorLookup | null;
  facts: OntologyFacts;
  nameIndex: ToolNameIndex;
}

interface DerivedDepend {
  tools: string[];
  missing: string[];
}

/**
 * `dependTools` 推导（FR-009）。
 *
 * - `command`：前置函数**本身** + 这些函数关联概念的同本体 query 行为；
 * - `query`：空；
 * - `function`（本体函数）：其关联概念的同本体 query 行为；
 * - `function`（非本体工具）：无关联概念，自然为空。
 *
 * `coreAction` 自身不入集合（可见工具集已包含它）。
 */
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
