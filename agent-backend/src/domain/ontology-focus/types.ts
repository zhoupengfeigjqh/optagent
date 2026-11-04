/**
 * 本体技能聚焦（016）的共享类型。
 *
 * 只建模本特性用到的字段：`metadata` / `functions` / `behaviors` / `rules`。
 * `concepts` / `relations` / 参数 / 代码一律不建模——不建模才不会被误用。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/** 本体函数（只取判定与展示需要的字段） */
export interface OntologyFunction {
  name: string;
  title: string;
}

/** 本体行为；`opType` 仅留档，不参与题面（FR-022） */
export interface OntologyBehavior {
  name: string;
  title: string;
  opType: string | null;
}

/**
 * 规则：`behavior` 是触发主行为，`dataSupplements` 是主行为执行前需要就绪的查询行为。
 *
 * `relatedFunctions` 刻意不建模：它属于规则内部的校验实现，不构成用户意图维度的候选
 * （FR-033 明确不提取、不使用）。
 */
export interface OntologyRule {
  behavior: string;
  dataSupplements: string[];
}

/** 一份 ontology.yaml 中与本特性相关的部分 */
export interface OntologyDefinition {
  filePath: string;
  ontologyId: string;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
  functions: OntologyFunction[];
  behaviors: OntologyBehavior[];
  rules: OntologyRule[];
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

/** 能力候选：行为或函数 */
export interface CapabilityCandidate {
  qid: string;
  kind: 'behavior' | 'function';
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  /** 同一本体内的原序（用于补充项的稳定追加） */
  index: number;
}

/** 入选来源：直接入选 / 数据补充 / 两者都有 */
export type FocusSource = 'direct' | 'supplement' | 'direct+supplement';

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

/** 能力决策 */
export interface CapabilityDecision {
  kind: 'behavior' | 'function';
  name: string;
  title: string;
  ontologyId: string;
  ontologyName: string | null;
  score: number | null;
  selected: boolean;
  source: FocusSource;
  index: number;
}

/** 一条数据补充明细（`found=false` = 声明了但本体里找不到，已丢弃） */
export interface DataSupplement {
  ontologyId: string;
  /** 触发补充的主行为 */
  behavior: string;
  /** 被声明的行为名 */
  supplement: string;
  found: boolean;
}

/** 一批 noul 命题：键为 `qid` */
export type QuestionMap = Record<string, SystemOneQuestion>;

/** 能力聚焦结果（行为 / 函数分类保存） */
export interface CapabilitySelection {
  behaviors: CapabilityDecision[];
  functions: CapabilityDecision[];
  supplements: DataSupplement[];
  truncated: boolean;
}

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
