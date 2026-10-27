<script setup lang="ts">
/**
 * 本体卡片列表（`FR-058`）：每张卡片展示 6 项 metadata + 路径 + 查看入口。
 *
 * 6 项固定按 `created_at / deployed_version / scenario_name / scenario_id /
 * ontology_name / ontology_id` 顺序呈现；缺项显示 `—`（后端保证缺项为 `null`，
 * 「字段缺失」不阻塞导入，界面也不该因此把整张卡片变成不可用）。
 *
 * **卡片名称固定为 `{场景名}-{本体名}`**（2026-10-17）：本体身份就是这两段，
 * 只显示本体名会把「同名本体分属不同场景」的情况显示成两张一样的卡片。
 * 取名口径与详情页标题、删除确认、全局播报共用 `utils/ontology-name.ts`。
 */
import type { OntologyListItem, OntologyMetadata } from '../../api/ontologies'
import type { ErrorInfo } from '../../api/types'
import { ontologyDisplayName, ontologyNameOf, ontologyScenarioOf } from '../../utils/ontology-name'
import EntityCardList from '../common/EntityCardList.vue'

defineProps<{
  items: OntologyListItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  /** 打开本体详情：身份是"场景 + 目录名"两段 */
  (e: 'open', target: { scenario: string; ontologyDir: string }): void
}>()

/** 6 项 metadata 的展示标签与取值函数（顺序即界面顺序） */
const META_ROWS: ReadonlyArray<{ label: string; key: keyof OntologyMetadata }> = [
  { label: '创建时间', key: 'created_at' },
  { label: '部署版本', key: 'deployed_version' },
  { label: '场景名', key: 'scenario_name' },
  { label: '场景 ID', key: 'scenario_id' },
  { label: '本体名', key: 'ontology_name' },
  { label: '本体 ID', key: 'ontology_id' },
]

function valueOf(metadata: OntologyMetadata, key: keyof OntologyMetadata): string {
  const value = metadata?.[key]
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

/** 卡片名称：`{场景名}-{本体名}`（与详情页标题、播报同一实现） */
function cardName(item: OntologyListItem): string {
  return ontologyDisplayName(item)
}
</script>

<template>
  <EntityCardList
    title="本体管理"
    :items="items"
    :total="total"
    :page="page"
    :loading="loading"
    :error="error"
    :item-key="
      (item) =>
        `${ontologyScenarioOf(item as OntologyListItem)}/${ontologyNameOf(item as OntologyListItem)}`
    "
    empty-title="本体库为空"
    empty-description="从本体市场导入一个本体即可建立第一条记录（导入 ontology.yaml 与 securities.yaml 两个文件）。"
    @update:page="emit('update:page', $event)"
  >
    <template #item="{ item }">
      <article class="card" :aria-label="`本体 ${cardName(item as OntologyListItem)}`">
        <p class="card__title">{{ cardName(item as OntologyListItem) }}</p>
        <dl class="card__meta-list">
          <div v-for="row in META_ROWS" :key="row.key" class="card__meta-row">
            <dt>{{ row.label }}</dt>
            <dd>{{ valueOf((item as OntologyListItem).metadata, row.key) }}</dd>
          </div>
        </dl>
        <div class="card__actions">
          <button
            type="button"
            class="btn"
            :aria-label="`查看本体 ${cardName(item as OntologyListItem)}`"
            @click="
              emit('open', {
                scenario: ontologyScenarioOf(item as OntologyListItem),
                ontologyDir: ontologyNameOf(item as OntologyListItem),
              })
            "
          >
            查看
          </button>
        </div>
      </article>
    </template>
  </EntityCardList>
</template>

<style scoped>
.card__meta-list {
  margin: var(--space-3) 0 0;
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
}

.card__meta-row {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
  line-height: 1.7;
}

.card__meta-row dt {
  color: var(--color-text-muted);
  flex-shrink: 0;
}

.card__meta-row dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
</style>
