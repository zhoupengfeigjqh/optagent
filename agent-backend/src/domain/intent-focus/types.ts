import type { SystemOneQuestion } from '../../infra/laya-client.js';

/**
 * 本体行为；题面按 `description → title → name` 降级（FR-022），
 * `opType` 仅留档，不参与题面。
 */
export interface OntologyBehavior {
  name: string;
  title: string;
  /** 行为描述；缺失为空串（不在此处回退，降级顺序在题面构造时统一裁决） */
  description: string;
  opType: string | null;
  concept: string | null;
}

export interface OntologyFunction {
  name: string;
  title: string;
  /** 函数描述；缺失为空串（题面降级顺序与行为一致） */
  description: string;
  relatedConcepts: string[];
}

export interface OntologyConcept {
  name: string;
  title: string;
}

export interface OntologyRelation {
  name: string;
  source: string;
  target: string;
  /**
   * 关系中文名（`relations[].title`），五元组展示用；缺省 null 表示本体文件没写，
   * 展示层回退 `name`（升版兼容：老本体不写 title 也不会让提示出现空槽）。
   */
  title?: string | null;
  relationType: string[];
  cardinality: string | null;
}

export interface OntologyDefinition {
  filePath: string;
  ontologyId: string;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
  behaviors: OntologyBehavior[];
  functions: OntologyFunction[];
  concepts: OntologyConcept[];
  relations: OntologyRelation[];
}

export interface OntologyIndex {
  byId: Map<string, OntologyDefinition[]>;
  all: OntologyDefinition[];
  warnings: string[];
}

export interface SkillCandidate {
  qid: string;
  header: SkillHeaderLike;
  matchedOntologies: OntologyDefinition[];
  isOntologySkill: boolean;
  index: number;
}

/** `skill-header.ts` 的结构子集（避免 types 与实现互相 import） */
export interface SkillHeaderLike {
  name: string;
  description: string;
  dirName: string;
  metadata: {
    ontologyId: string | null;
    ontologyName: string | null;
    scenarioId: string | null;
    scenarioName: string | null;
  };
}

export type CapabilityKind = 'behavior' | 'function';

export interface CapabilityCandidate {
  qid: string;
  kind: CapabilityKind;
  name: string;
  title: string;
  description: string;
  ontologyId: string;
  ontologyName: string | null;
  concept: string | null;
  relatedConcepts: string[];
  index: number;
}

export interface SkillDecision {
  header: SkillHeaderLike;
  isOntology: boolean;
  ontologyId: string | null;
  score: number | null;
  selected: boolean;
  reason: string | null;
}

export interface CapabilityDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  concept: string | null;
  score: number;
  index: number;
}

export interface FunctionDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  score: number;
  relatedConcepts: string[];
  index: number;
}

export interface ConceptQueryDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  concept: string;
  index: number;
}

export interface CapabilitySelection {
  behaviors: CapabilityDecision[];
  functions: FunctionDecision[];
  conceptQueries: ConceptQueryDecision[];
}

export type QuestionMap = Record<string, SystemOneQuestion>;

export interface FocusToolTip {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
}


export type BehaviorSource = 'direct' | 'upstream' | 'downstream' | 'concept_query';

export interface ExpansionEdge {
  /**
   * 所属本体。**必须带**：`ExpansionChannel` 是多个入选本体累加出来的，
   * 两个本体出现同名概念时，靠它区分"这条边属于谁"，否则路径会串到别的本体。
   */
  ontologyId: string;
  from: string;
  relation: string;
  to: string;
  hop: number;
}

export interface ExpandedConcept {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  hop: number;
  viaConcept: string;
  viaRelation: string;
  /**
   * 本跳的**全部**入边（2026-11-26 修丢边）。
   *
   * 概念只发散一次（`visited` 去环），但"从哪几条关系过来"必须全留：
   * 多起点共享同一上游时（库存 → 原材料 ← 采购单），只留首条入边会让后到的
   * 起点行为整条路径消失，`record.concepts[].viaConcept` 也会指错来路。
   */
  edges: ExpansionEdge[];
}

export interface ExpandedBehavior {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  concept: string | null;
  hop: number;
  viaConcept: string;
  fromConcept: string;
}

/** 单个通道的发散产出（概念 + 行为，各自独立上限） */
export interface ExpansionChannel {
  concepts: ExpandedConcept[];
  behaviors: ExpandedBehavior[];
  directEdges: ExpansionEdge[];
}

/** 一次发散的总产出；`truncated` 表示行为候选触达上限 */
export interface ExpansionResult {
  upstream: ExpansionChannel;
  downstream: ExpansionChannel;
  warnings: string[];
  truncated: boolean;
}
