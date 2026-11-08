/**
 * 本体技能聚焦（016 / 019）的共享类型。
 *
 * 2026-11-06 调整：能力聚焦**只保留本体行为**，本体函数与规则数据补充整体移除；
 * `rules` / `data_supplements` 不再解析、不再留档。
 *
 * 2026-11-08（019）调整：聚焦阶数开启时，需要按**对象关系**做同向一阶发散，
 * 因此新增 `concepts` / `relations` 与 `behaviors[].concept` 三处只读建模。
 * 参数正文、函数代码、`rules` 仍然不建模。
 */
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
  /**
   * 行为所属概念（`behaviors[].concept`，单值）。
   *
   * 019：概念是"行为 → 概念 → 关系 → 邻居概念 → 邻居行为"这条发散链的唯一入口，
   * 缺失即为断链（该行为照常参与判定，只是不参与发散）。
   */
  concept: string | null;
}

/** 本体概念（019）：只取发散所需的展示与关联字段 */
export interface OntologyConcept {
  name: string;
  title: string;
}

/**
 * 对象关系（019）：`concepts[]` 之间的有向连接。
 *
 * **不在此处判定上下游**——方向是 `expansion.ts` 的唯一职责（同一事实只有一处解释），
 * 这里只保留判定所需的原始信号。
 */
export interface OntologyRelation {
  name: string;
  source: string;
  target: string;
  /** `relation_type` 原样（`Functional` / `InverseFunctional`） */
  relationType: string[];
  /** `cardinality` 原样（`'1:1'` / `'N:1'` / `'1:N'` …），缺省 null */
  cardinality: string | null;
}

/** 一份 ontology.yaml 中与本特性相关的部分 */
export interface OntologyDefinition {
  filePath: string;
  ontologyId: string;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
  behaviors: OntologyBehavior[];
  concepts: OntologyConcept[];
  relations: OntologyRelation[];
}

/** 按归一化 `ontology_id` 建索引；同一 ID 的多个文件全部保留 */
export interface OntologyIndex {
  byId: Map<string, OntologyDefinition[]>;
  all: OntologyDefinition[];
  warnings: string[];
}

/** 技能候选：只对"可聚焦技能"生成（非本体技能 + 已匹配本体的本体技能） */
export interface SkillCandidate {
  /** 不透明题号 `s1..sN`，与 `questions` 的键一一对应 */
  qid: string;
  header: SkillHeaderLike;
  matchedOntologies: OntologyDefinition[];
  isOntologySkill: boolean;
  /** 原序下标，用于同分稳定排序 */
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

/** 行为候选（2026-11-06 起唯一的候选形态） */
export interface CapabilityCandidate {
  qid: string;
  name: string;
  title: string;
  /** 题面首选的描述文本；空串表示该行为没有描述 */
  description: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 所属概念（019 发散起点）；缺失为 null */
  concept: string | null;
  /** 同一本体内的原序（用于同分稳定排序） */
  index: number;
}

/** 技能决策（含未入选者，供留档分析） */
export interface SkillDecision {
  header: SkillHeaderLike;
  isOntology: boolean;
  /** 关联本体 id：一个本体技能恒只有一个本体；非本体技能与未匹配本体的技能为 null */
  ontologyId: string | null;
  score: number | null;
  selected: boolean;
  reason: string | null;
}

/** 行为决策：只表达"已入选"的行为 */
export interface CapabilityDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 所属概念（019 发散起点）；缺失为 null */
  concept: string | null;
  score: number;
  index: number;
}

/**
 * 行为聚焦结果（唯一能力类别）。
 *
 * 不带 `truncated`：候选上限在构造阶段由 `max_capabilities` 唯一决定，
 * 选择阶段不再有第二层截断（FR-053），该标志恒为假，属冗余字段。
 */
export interface CapabilitySelection {
  behaviors: CapabilityDecision[];
}

/** 一批 noul 命题：键为 `qid` */
export type QuestionMap = Record<string, SystemOneQuestion>;

/**
 * 下一步动作卡片的工具提示（`tool_tips` 元素）。
 *
 * **wire 形态**：字段名与下发给模型 / 前端 / 快照的 JSON 完全一致（下划线命名），
 * 因此从判定结果一路透传到卡片不需要二次改名。字段值只来自本体文件，不做校验、不改写。
 */
export interface FocusToolTip {
  name: string;
  title: string;
  ontology_id: string;
  ontology_name: string | null;
}

/* ---------- 019：一阶发散（上游进提示 / 下游进卡片） ---------- */

/** 发散通道：上游（进提示词） / 下游（进下一步动作卡片） */
export type ExpansionSide = 'upstream' | 'downstream';

/** 行为来源：直接命中 / 上游发散 / 下游发散（留档与提示分段共用） */
export type BehaviorSource = 'direct' | 'upstream' | 'downstream';

/** 发散得到的概念（`hop ≥ 1`；direct 概念不进本结构） */
export interface ExpandedConcept {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  /** 距离 direct 概念的跳数（1..depth） */
  hop: number;
  /** 由哪个概念扩展而来（BFS 首次命中的路径） */
  viaConcept: string;
  /** 经由哪条关系扩展而来 */
  viaRelation: string;
}

/** 发散得到的行为（`score` 恒为 null：不再判分，见 019 FR） */
export interface ExpandedBehavior {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  /** 所属概念（即 `viaConcept`），用于留档溯源 */
  concept: string | null;
  hop: number;
  viaConcept: string;
}

/** 单个通道的发散产出（概念 + 行为，各自独立上限） */
export interface ExpansionChannel {
  concepts: ExpandedConcept[];
  behaviors: ExpandedBehavior[];
}

/** 一次发散的总产出；`truncated` 表示行为候选触达上限 */
export interface ExpansionResult {
  upstream: ExpansionChannel;
  downstream: ExpansionChannel;
  warnings: string[];
  truncated: boolean;
}
