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

/** 本体卡片（`§10.1`；**不含正文**，正文按需在详情取） */
export interface OntologyListItem {
  /** 场景名（一级目录名） */
  scenario: string
  /** 本体目录名（二级目录名）；与场景名一起构成本体的身份 */
  ontology_dir: string
  /** 展示名：`metadata.ontology_name`，缺失时兜底为目录名 */
  name: string
  metadata: OntologyMetadata
  source: string
  hash: string
  /** 是否已同步行为安全管控文件（`securities.yaml`）；卡片徽标用它 */
  has_securities: boolean
  installed_at: string
  updated_at: string
}

/** 本体详情（`§10.2`）：记录 + 两个文件的全文（只读视图的数据源） */
export interface OntologyDetail extends OntologyListItem {
  /** `ontology.yaml` 全文 */
  content: string
  size: number
  /** `securities.yaml` 全文；该本体未同步安全管控时为 `null` */
  securities_content: string | null
  /** `securities.yaml` 字节数；未同步时为 0 */
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
  /** `ontology.yaml` 的 sha256（与库内记录的 `hash` 比对即知"市场是否变化"） */
  hash: string
  /** 市场侧是否有 `securities.yaml`（缺失 = 该本体未配置行为安全管控，不是错误） */
  has_securities: boolean
  /** `securities.yaml` 字节数；无该文件为 0 */
  securities_size: number
  /** `securities.yaml` 的 sha256；无该文件为 `null` */
  securities_hash: string | null
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

/** 本体详情：含 `ontology.yaml` 全文（只读展示） */
export function fetchOntology(ontologyDir: string, scenario: string): Promise<OntologyDetail> {
  return http.get<OntologyDetail>(`/api/admin/ontologies/${encodeURIComponent(ontologyDir)}`, {
    scenario,
  })
}

/** 删除本体（身份 = 场景 + 目录名，故场景走查询参数） */
export function deleteOntology(ontologyDir: string, scenario: string): Promise<void> {
  const query = `?scenario=${encodeURIComponent(scenario)}`
  return http.del<void>(`/api/admin/ontologies/${encodeURIComponent(ontologyDir)}${query}`)
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
