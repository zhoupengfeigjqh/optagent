<script setup lang="ts">
/**
 * SKILL 卡片列表（`FR-035`）：展示技能名与描述。
 *
 * 固定四段（2026-11-04）：
 * 1. 展示名（`display_name`，来自 `SKILL.md` 的 `metadata.*`，缺失回落 `name`）；
 * 2. 身份名 `name`——它是目录名与数字人的引用键，与展示名不同时显示；
 * 3. `描述：…`；
 * 4. `来源：…`——只有本体市场导入的技能有来源路径，ZIP 等外部安装整行不渲染。
 */
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
        <!-- 展示名与身份名不同时补一行小字：`name` 是目录名与数字人引用键 -->
        <p v-if="skillHasAlias(item as SkillListItem)" class="card__name mono">
          {{ (item as SkillListItem).name }}
        </p>
        <p class="card__description">描述：{{ (item as SkillListItem).description }}</p>
        <!-- 来源路径只有本体市场导入的技能才有；外部安装（ZIP 等）不渲染该行 -->
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
/* 来源标记（2026-10-02）：本体市场导入 / 外部安装（ZIP 上传等） */
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

/* 身份名小字：展示名与 `name` 不同时才渲染 */
.card__name {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
</style>
