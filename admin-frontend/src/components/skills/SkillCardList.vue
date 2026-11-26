<script setup lang="ts">
import type { ErrorInfo, SkillListItem } from '../../api/types'
import { skillDisplayName, skillHasAlias } from '../../utils/skill-name'
import { skillSourcePath } from '../../utils/skill-source'
import EntityCardList from '../common/EntityCardList.vue'

defineProps<{
  items: SkillListItem[]
  total: number
  page: number
  loading: boolean
  error: ErrorInfo | null
}>()

const emit = defineEmits<{
  (e: 'update:page', value: number): void
  (e: 'open', name: string): void
}>()
</script>

<template>
  <EntityCardList
    title="SKILL 管理"
    :items="items"
    :total="total"
    :page="page"
    :loading="loading"
    :error="error"
    :item-key="(item) => (item as SkillListItem).name"
    empty-title="共享技能库为空"
    empty-description="上传一个含 SKILL.md 的 ZIP 包即可建立第一个技能。"
    @update:page="emit('update:page', $event)"
  >
    <template #item="{ item }">
      <article class="card" :aria-label="`SKILL ${(item as SkillListItem).name}`">
        <p class="card__title">
          {{ skillDisplayName(item as SkillListItem) }}
          <span
            class="card__origin"
            :class="
              (item as SkillListItem).origin?.kind === 'onto_market'
                ? 'card__origin--market'
                : 'card__origin--external'
            "
          >
            {{
              (item as SkillListItem).origin?.kind === 'onto_market'
                ? '本体市场 · 只读'
                : '外部安装'
            }}
          </span>
        </p>
        <p v-if="skillHasAlias(item as SkillListItem)" class="card__name mono">
          {{ (item as SkillListItem).name }}
        </p>
        <p class="card__description">描述：{{ (item as SkillListItem).description }}</p>
        <p v-if="skillSourcePath(item as SkillListItem) !== ''" class="card__meta">
          来源：{{ skillSourcePath(item as SkillListItem) }}
        </p>
        <div class="card__actions">
          <button
            type="button"
            class="btn"
            :aria-label="`查看 SKILL ${(item as SkillListItem).name}`"
            @click="emit('open', (item as SkillListItem).name)"
          >
            查看与编辑
          </button>
        </div>
      </article>
    </template>
  </EntityCardList>
</template>

<style scoped>
.card__origin {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  vertical-align: middle;
}

.card__origin--market {
  background: var(--color-primary-subtle);
  color: var(--color-primary);
}

.card__origin--external {
  background: var(--color-bg-muted);
  color: var(--color-text-muted);
}

.card__name {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
</style>
