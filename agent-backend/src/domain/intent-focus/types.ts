/**
 * 本体技能聚焦（016 / 019）的共享类型。
 *
 * 2026-11-06 调整：能力聚焦**只保留本体行为**，本体函数与规则数据补充整体移除；
 * `rules` / `data_supplements` 不再解析、不再留档。
 *
 * 2026-11-08（019）调整：聚焦阶数开启时，需要按**对象关系**做同向一阶发散，
 * 因此新增 `concepts` / `relations` 与 `behaviors[].concept` 三处只读建模。
 * 参数正文、函数代码、`rules` 仍然不建模。
 *
 * 2026-11-20 调整：**函数窄口径恢复**——只读 `functions[]` 的
 * `name` / `title` / `description` / `related_concepts` 四字段（`params` / `response` 仍不进来）；
 * 函数与行为进同一批候选、共用 `max_capabilities`，但各自阈值与各自结果集。
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

/**
 * 本体函数（2026-11-20）：只取判分与取数所需的四个字段。
 *
 * **不建模** `params` / `response`——它们可能很大，而且与"本轮要不要用这个函数"无关；
 * 读进来只会让人误以为它们参与判定。
 */
export interface OntologyFunction {
  name: string;
  title: string;
  /** 函数描述；缺失为空串（题面降级顺序与行为一致） */
  description: string;
  /** `functions[].related_concepts` 归一化后的概念名；缺失为空数组 */
  relatedConcepts: string[];
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
  /**
   * 关系中文名（`relations[].title`），五元组展示用；缺省 null 表示本体文件没写，
   * 展示层回退 `name`（升版兼容：老本体不写 title 也不会让提示出现空槽）。
   */
  title?: string | null;
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
  /** 2026-11-20 恢复解析；缺失按空数组 */
  functions: OntologyFunction[];
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

/**
 * 能力候选类别（2026-11-20）：行为与函数共用同一候选序列与同一批 `noul` 判定，
 * 类别只影响阈值（行为 / 函数各一）与题面措辞。
 */
export type CapabilityKind = 'behavior' | 'function';

/** 能力候选：行为与函数共用（2026-11-20 起不再只有行为） */
export interface CapabilityCandidate {
  qid: string;
  kind: CapabilityKind;
  name: string;
  title: string;
  /** 题面首选的描述文本；空串表示该项没有描述 */
  description: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 行为：所属概念（019 发散起点）；函数恒 null */
  concept: string | null;
  /** 函数：依赖的概念名（取数入口）；行为恒空数组 */
  relatedConcepts: string[];
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

/** 函数决策：只表达"已入选"的函数（2026-11-20） */
export interface FunctionDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 入选分数（恒 > 函数阈值） */
  score: number;
  /** 依赖的概念名（取数入口） */
  relatedConcepts: string[];
  index: number;
}

/**
 * 关联概念取数行为（2026-11-20）。
 *
 * 由入选函数的 `related_concepts` 带出：同本体内 `op_type: query` 的行为。
 * **不判分**（没有 `score` 字段），也不参与发散与卡片——它只是"要用这个函数，先取这些数"。
 */
export interface ConceptQueryDecision {
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 该行为所属概念（即触发取数的关联概念） */
  concept: string;
  index: number;
}

/**
 * 能力聚焦结果：行为、函数、取数三集分开。
 *
 * 三集必须彼此独立——`toolTips` 只吃 `behaviors` + 下游发散，
 * 函数与取数一旦混进 `behaviors` 就会漏进卡片目录（FR-069 的机制保证）。
 *
 * 不带 `truncated`：候选上限在构造阶段由 `max_capabilities` 唯一决定，
 * 选择阶段不再有第二层截断（FR-053），该标志恒为假，属冗余字段。
 */
export interface CapabilitySelection {
  behaviors: CapabilityDecision[];
  functions: FunctionDecision[];
  conceptQueries: ConceptQueryDecision[];
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

/**
 * 行为来源（留档与提示分段共用）：
 * 直接命中 / 上游发散 / 下游发散 / 关联概念取数（2026-11-20，由函数带出，不判分）
 */
export type BehaviorSource = 'direct' | 'upstream' | 'downstream' | 'concept_query';

/** 发散的一条入边（2026-11-26） */
export interface ExpansionEdge {
  /**
   * 所属本体。**必须带**：`ExpansionChannel` 是多个入选本体累加出来的，
   * 两个本体出现同名概念时，靠它区分"这条边属于谁"，否则路径会串到别的本体。
   */
  ontologyId: string;
  /** 这一跳的起点概念 */
  from: string;
  /** 经由的关系名 */
  relation: string;
  /** 这一跳的终点概念 */
  to: string;
  /** 跳数 */
  hop: number;
}

/** 发散得到的概念（`hop ≥ 1`；direct 概念不进本结构） */
export interface ExpandedConcept {
  ontologyId: string;
  ontologyName: string | null;
  name: string;
  title: string;
  /** 距离 direct 概念的跳数（1..depth） */
  hop: number;
  /** 由哪个概念扩展而来（`edges[0]`，留档用的单值口径） */
  viaConcept: string;
  /** 经由哪条关系扩展而来（`edges[0]`） */
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
  /**
   * 这一跳的**起点概念**（2026-11-13）＝ `viaConcept` 那条发散概念的 `viaConcept`。
   *
   * 留档为什么需要它：上游能由 `viaConcept` 反推（概念表里记的就是起点），但**下游概念不落档**，
   * 而下游是多源汇聚的（原材料 / 供应商 / 客户订单 都可以发散到采购单），只记自身概念
   * 无法判断"这条卡片项是从哪个概念发散来的"。
   */
  fromConcept: string;
}

/** 单个通道的发散产出（概念 + 行为，各自独立上限） */
export interface ExpansionChannel {
  concepts: ExpandedConcept[];
  behaviors: ExpandedBehavior[];
  /**
   * 指向**直接命中概念**的边（2026-11-26 修丢边）。
   *
   * 这些概念本身已在「关键行为」里，所以不再作为发散概念重复出现；但
   * "从某个命中行为的所属概念，经哪条关系到达它"仍是有效的上下游关系。
   * 不记这一段时，`QueryInventory →（拥有库存）→ RawMaterial` 这类
   * 「命中概念 ↔ 命中概念」的边会整条消失（2026-11-26 实测）。
   */
  directEdges: ExpansionEdge[];
}

/** 一次发散的总产出；`truncated` 表示行为候选触达上限 */
export interface ExpansionResult {
  upstream: ExpansionChannel;
  downstream: ExpansionChannel;
  warnings: string[];
  truncated: boolean;
}
