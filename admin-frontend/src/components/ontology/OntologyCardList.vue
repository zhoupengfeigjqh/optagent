<script setup lang="ts">
/**
 * 本体卡片列表（`FR-058`）：每张卡片展示 6 项 metadata + 路径 + 查看入口。
 *
 * 6 项固定按 `created_at / deployed_version / scenario_name / scenario_id /
 * ontology_name / ontology_id` 顺序呈现；缺项显示 `—`（后端保证缺项为 `null`，
 * 「字段缺失」不阻塞导入，界面也不该因此把整张卡片变成不可用）。
 *
 * 徽标两个：场景名（来源）与「含安全管控」（`has_securities`，2026-10-03）——
 * 后者提示该本体已同步 `securities.yaml`，详情里可读到行为安全管控原文。
 */
import type { OntologyListItem, OntologyMetadata } from '../../api/ontologies'
import type { ErrorInfo } from '../../api/types'
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
</script>

<template>
  <EntityCardList
    title="本体管理"
    :items="items"
    :total="total"
    :page="page"
    :loading="loading"
    :error="error"
    :item-key="(item) => `${(item as OntologyListItem).scenario}/${(item as OntologyListItem).ontology_dir}`"
    empty-title="本体库为空"
    empty-description="从本体市场导入一个本体即可建立第一条记录（导入 ontology.yaml 与可选的 securities.yaml）。"
    @update:page="emit('update:page', $event)"
  >
    <template #item="{ item }">
      <article
        class="card"
        :aria-label="`本体 ${(item as OntologyListItem).name}`"
      >
        <p class="card__title">
          {{ (item as OntologyListItem).name }}
          <span class="card__origin">{{ (item as OntologyListItem).scenario }}</span>
          <span
            v-if="(item as OntologyListItem).has_securities"
            class="card__origin card__origin--securities"
            data-test="securities-badge"
            title="已同步 securities.yaml（行为安全管控），详情可查看原文"
          >
            含安全管控
          </span>
        </p>
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
            :aria-label="`查看本体 ${(item as OntologyListItem).name}`"
            @click="
              emit('open', {
                scenario: (item as OntologyListItem).scenario,
                ontologyDir: (item as OntologyListItem).ontology_dir,
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
/* 来源/场景标记：与 SKILL 卡片的来源徽标同构（风格一致） */
.card__origin {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  background: var(--color-primary-subtle);
  color: var(--color-primary);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  vertical-align: middle;
}

/* 「含安全管控」徽标（2026-10-03）：灰底 + 成功色文字，与场景徽标区分开 */
.card__origin--securities {
  background: var(--color-bg-muted);
  color: var(--color-status-success);
}

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
