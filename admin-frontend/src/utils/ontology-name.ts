import type { OntologyMetadata } from '../api/ontologies'

export interface OntologyNameSource {
  scenario?: string | null
  name?: string | null
  ontology_dir?: string | null
  metadata?: OntologyMetadata | null
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

export function ontologyScenarioOf(item: OntologyNameSource | null | undefined): string {
  if (!item) return ''
  return firstText(item.scenario, item.metadata?.scenario_name)
}

export function ontologyNameOf(item: OntologyNameSource | null | undefined): string {
  if (!item) return ''
  return firstText(item.name, item.metadata?.ontology_name, item.ontology_dir)
}

export function ontologyDisplayName(item: OntologyNameSource | null | undefined): string {
  const scenario = ontologyScenarioOf(item)
  const name = ontologyNameOf(item)
  if (scenario === '') return name === '' ? '—' : name
  if (name === '') return scenario
  return `${scenario}-${name}`
}
