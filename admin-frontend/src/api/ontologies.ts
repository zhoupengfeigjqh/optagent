/**
 * 本体管理 API（`contracts/admin-api.md` §10，2026-10-03）。
 *
 * 独立成文件的原因同 `api/onto-market.ts`：`api/types.ts` 触及 500 行门禁，
 * 本组类型随「本体管理」功能整体新增，就近安置。
 *
 * 只读口径（`FR-059`）：本文件**没有**任何写本体的函数——平台只提供
 * 列表/详情/删除与"从本体市场导入/更新"，不提供编辑本体内容的能力。
 */
import { http } from './http'
import type { Paged } from './types'

/** 卡片展示用的 6 项 metadata（缺项为 `null`） */
export interface OntologyMetadata {
  created_at: string | null
  deployed_version: string | null
  scenario_name: string | null
  scenario_id: string | number | null
  ontology_name: string | null
  ontology_id: string | number | null
}

/**
 * 本体卡片（`§10.1`；**不含正文**，正文按需在详情取）。
 *
 * 身份只在 `metadata.scenario_name` / `metadata.ontology_name` 里（2026-10-17）——
 * 服务端不再下发 `scenario` / `ontology_dir` / `name` / `source` 四个副本字段。
 */
export interface OntologyListItem {
  metadata: OntologyMetadata
  /** `ontology.yaml` 的内容指纹（sha256） */
  ontology_hash: string
  installed_at: string
  updated_at: string
}

/**
 * 设计器候选（`§5.6` 的 `ontologies`，2026-10-17）：只有 `metadata`，**不含正文**。
 *
 * 正文由部署物化时从库内读；设计态只保存引用（`{场景名}/{本体名}`），
 * 库里换了版本下次部署即生效。
 */
export interface OntologyCandidate {
  metadata: OntologyMetadata
}

/** 本体详情（`§10.2`）：记录 + 两个文件的全文（只读视图的数据源） */
export interface OntologyDetail extends OntologyListItem {
  /** `ontology.yaml` 全文 */
  content: string
  size: number
  /** `securities.yaml` 全文（必填文件，与 ontology.yaml 一并同步） */
  securities_content: string
  /** `securities.yaml` 字节数 */
  securities_size: number
  revision: number
}

export type OntologyMarketStatus = 'new' | 'unchanged' | 'changed' | 'invalid'

/** 本体市场里的一份本体（`§10.4`，平台对市场只读） */
export interface OntologyMarketItem {
  scenario: string
  ontology_dir: string
  name: string | null
  metadata: OntologyMetadata | null
  size: number
  /** `ontology.yaml` 的 sha256（与库内记录的 `ontology_hash` 比对即知"市场是否变化"） */
  ontology_hash: string
  /** `securities.yaml` 字节数 */
  securities_size: number
  /** `securities.yaml` 的 sha256 */
  securities_hash: string
  status: OntologyMarketStatus
  /** 市场侧 `ontology.yaml` 缺失/超限/YAML 无效时的可读原因；非 null 不可导入 */
  invalid_reason: string | null
}

export interface OntologyMarketListing {
  /** 是否配置了 ONTO_MARKET_DIR；false = 功能不可用（reason 给出原因） */
  configured: boolean
  reason: string | null
  items: OntologyMarketItem[]
}

/** 导入/更新结果（`§10.5`/`§10.6`） */
export interface OntologyWriteResult {
  scenario: string
  ontology_dir: string
  name: string
  metadata: OntologyMetadata
  /** 首次导入时间（更新不改变它） */
  installed_at: string
  /** 是否为更新（首次导入为 false） */
  overwritten: boolean
}

/** 本体卡片列表（服务端固定 8 项/页） */
export function listOntologies(page = 1): Promise<Paged<OntologyListItem>> {
  return http.get<Paged<OntologyListItem>>('/api/admin/ontologies', { page })
}

/**
 * 本体详情：含 `ontology.yaml` 全文（只读展示）。
 *
 * URL 口径（2026-10-17）：`{scenario_name}/{ontology_name}`——两段都在路径上，
 * 顺序与 `metadata` 字段、与部署路径 `ontology/{场景}/{本体}/` 一致。
 */
export function fetchOntology(scenarioName: string, ontologyName: string): Promise<OntologyDetail> {
  return http.get<OntologyDetail>(
    `/api/admin/ontologies/${encodeURIComponent(scenarioName)}/${encodeURIComponent(ontologyName)}`,
  )
}

/** 删除本体（身份 = 场景名 + 本体名，两段都在路径上） */
export function deleteOntology(scenarioName: string, ontologyName: string): Promise<void> {
  return http.del<void>(
    `/api/admin/ontologies/${encodeURIComponent(scenarioName)}/${encodeURIComponent(ontologyName)}`,
  )
}

/** 本体市场：列出可导入的本体及其与库内的差异状态（打开即完成一次"是否变化"检查） */
export function fetchOntoMarketOntologies(): Promise<OntologyMarketListing> {
  return http.get<OntologyMarketListing>('/api/admin/ontologies/onto-market')
}

/** 从本体市场导入（重复导入 → 409 `ADM_ONTOLOGY_EXISTS`，界面应改用更新） */
export function importOntoMarketOntology(
  scenario: string,
  ontologyDir: string,
): Promise<OntologyWriteResult> {
  return http.post<OntologyWriteResult>('/api/admin/ontologies/onto-market/import', {
    scenario,
    ontology_dir: ontologyDir,
  })
}

/** 用市场现版本更新（库内不存在 → 400，界面应改用导入） */
export function updateOntoMarketOntology(
  scenario: string,
  ontologyDir: string,
): Promise<OntologyWriteResult> {
  return http.post<OntologyWriteResult>('/api/admin/ontologies/onto-market/update', {
    scenario,
    ontology_dir: ontologyDir,
  })
}
