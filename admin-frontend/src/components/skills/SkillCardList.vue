<script setup lang="ts">
/**
 * SKILL 卡片列表（`FR-035`）：展示技能名与描述。
 */
import type { ErrorInfo, SkillListItem } from '../../api/types'
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
        <p class="card__title">{{ (item as SkillListItem).name }}</p>
        <p class="card__description">{{ (item as SkillListItem).description }}</p>
        <p class="card__meta">
          来源 {{ (item as SkillListItem).source }} · 更新于 {{ (item as SkillListItem).updated_at }}
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
