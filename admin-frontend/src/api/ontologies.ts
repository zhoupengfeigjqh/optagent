import { http } from './http'
import type { Paged } from './types'

export interface OntologyMetadata {
  created_at: string | null
  deployed_version: string | null
  scenario_name: string | null
  scenario_id: string | number | null
  ontology_name: string | null
  ontology_id: string | number | null
}

export interface OntologyListItem {
  metadata: OntologyMetadata
  ontology_hash: string
  installed_at: string
  updated_at: string
}

export interface OntologyCandidate {
  metadata: OntologyMetadata
}

export interface OntologyDetail extends OntologyListItem {
  content: string
  size: number
  securities_content: string
  securities_size: number
  revision: number
}

export type OntologyMarketStatus = 'new' | 'unchanged' | 'changed' | 'invalid'

export interface OntologyMarketItem {
  scenario: string
  ontology_dir: string
  name: string | null
  metadata: OntologyMetadata | null
  size: number
  ontology_hash: string
  securities_size: number
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

export interface OntologyWriteResult {
  scenario: string
  ontology_dir: string
  name: string
  metadata: OntologyMetadata
  installed_at: string
  overwritten: boolean
}

export function listOntologies(page = 1): Promise<Paged<OntologyListItem>> {
  return http.get<Paged<OntologyListItem>>('/api/admin/ontologies', { page })
}

export function fetchOntology(scenarioName: string, ontologyName: string): Promise<OntologyDetail> {
  return http.get<OntologyDetail>(
    `/api/admin/ontologies/${encodeURIComponent(scenarioName)}/${encodeURIComponent(ontologyName)}`,
  )
}

export function deleteOntology(scenarioName: string, ontologyName: string): Promise<void> {
  return http.del<void>(
    `/api/admin/ontologies/${encodeURIComponent(scenarioName)}/${encodeURIComponent(ontologyName)}`,
  )
}

export function fetchOntoMarketOntologies(): Promise<OntologyMarketListing> {
  return http.get<OntologyMarketListing>('/api/admin/ontologies/onto-market')
}

export function importOntoMarketOntology(
  scenario: string,
  ontologyDir: string,
): Promise<OntologyWriteResult> {
  return http.post<OntologyWriteResult>('/api/admin/ontologies/onto-market/import', {
    scenario,
    ontology_dir: ontologyDir,
  })
}

export function updateOntoMarketOntology(
  scenario: string,
  ontologyDir: string,
): Promise<OntologyWriteResult> {
  return http.post<OntologyWriteResult>('/api/admin/ontologies/onto-market/update', {
    scenario,
    ontology_dir: ontologyDir,
  })
}
