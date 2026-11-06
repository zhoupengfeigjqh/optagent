/**
 * 本体技能聚焦（016）的共享类型。
 *
 * 2026-11-06 调整：能力聚焦**只保留本体行为**，本体函数与规则数据补充整体移除；
 * `rules` / `data_supplements` 不再解析、不再留档。
 *
 * 只建模本特性用到的字段：`metadata` / `behaviors`。
 * `concepts` / `relations` / 参数 / 代码一律不建模——不建模才不会被误用。
 */
import type { SystemOneQuestion } from '../../infra/laya-client.js';

/** 本体行为；`opType` 仅留档，不参与题面（FR-022） */
export interface OntologyBehavior {
  name: string;
  title: string;
  opType: string | null;
}

/** 一份 ontology.yaml 中与本特性相关的部分 */
export interface OntologyDefinition {
  filePath: string;
  ontologyId: string;
  ontologyName: string | null;
  scenarioId: string | null;
  scenarioName: string | null;
  behaviors: OntologyBehavior[];
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
  ontologyId: string;
  ontologyName: string | null;
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
