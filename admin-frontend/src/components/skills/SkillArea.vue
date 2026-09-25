<script setup lang="ts">
/**
 * SKILL 管理功能区（US3）：共享技能库的浏览、查看/编辑文件与上传安装。
 *
 * 文件保存后刷新详情与列表：`SKILL.md` 的描述可能已变，卡片不能停在旧值。
 */
import { onMounted, ref, watch } from 'vue'
import { http } from '../../api/http'
import type { Paged, SkillDetail, SkillFileSaved, SkillListItem } from '../../api/types'
import SkillCardList from './SkillCardList.vue'
import SkillViewer from './SkillViewer.vue'
import SkillUploadDialog from './SkillUploadDialog.vue'

const props = defineProps<{ detail: string | null; tab: string | null }>()
const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

const page = ref(1)
const list = ref<Paged<SkillListItem> | null>(null)
const error = ref<unknown>(null)
const loading = ref(false)
/** 当前打开的 SKILL 详情（与 props.detail 同名会与路由参数混淆，故显式改名） */
const skillDetail = ref<SkillDetail | null>(null)
const uploadOpen = ref(false)

async function loadList(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    list.value = await http.get<Paged<SkillListItem>>('/api/admin/skills', { page: page.value })
  } catch (err) {
    error.value = err
  } finally {
    loading.value = false
  }
}

async function loadDetail(name: string): Promise<void> {
  error.value = null
  try {
    skillDetail.value = await http.get<SkillDetail>(`/api/admin/skills/${encodeURIComponent(name)}`)
  } catch (err) {
    error.value = err
  }
}

/**
 * 文件已保存：刷新**卡片列表**，但 **MUST NOT 重载详情**（契约 §0.5 原则 ②）。
 *
 * 旧实现 `loadDetail(name)` 会换掉 `props.skill` 对象，经 `SkillViewer` 的
 * `selectFile` 一路把编辑区草稿重置——`SkillViewer.onSaved` 那边"就地改字段、
 * 不换对象以保留草稿"的努力因此全部作废。保存响应已带回新 `hash`/`size`，
 * `SkillViewer` 已就地写回，无需二次请求。
 *
 * 列表仍要刷：`SKILL.md` 改动会让服务端重新解析 `description`，卡片不能停在旧值。
 * 同时把"需重新部署才生效"这条**易被忽略的后果**明说一次——否则用户会以为
 * 改完数字人就已经变了。
 */
function onFileSaved(saved: SkillFileSaved): void {
  emit('announce', `已保存 ${saved.path}；引用了该技能的数字人需重新部署后生效`)
  void loadList()
}

onMounted(() => {
  void loadList()
  if (props.detail) void loadDetail(props.detail)
})

watch(
  () => props.detail,
  (name) => {
    if (name) void loadDetail(name)
    else {
      skillDetail.value = null
      void loadList()
    }
  },
)
</script>

<template>
  <section class="skill-area">
    <SkillViewer
      v-if="skillDetail"
      :skill="skillDetail"
      :error="(error as never)"
      @back="
        () => {
          skillDetail = null
          emit('navigate', '/skills')
        }
      "
      @deleted="
        () => {
          skillDetail = null
          emit('announce', 'SKILL 已删除')
          emit('navigate', '/skills')
          void loadList()
        }
      "
      @updated="onFileSaved"
    />
    <template v-else>
      <div class="skill-area__toolbar">
        <button type="button" class="btn btn--primary" @click="uploadOpen = true">
          上传安装 SKILL
        </button>
      </div>

      <SkillCardList
        :items="list?.items ?? []"
        :total="list?.total ?? 0"
        :page="page"
        :loading="loading"
        :error="(error as never)"
        @update:page="
          (next) => {
            page = next
            void loadList()
          }
        "
        @open="(name) => emit('navigate', `/skills/${encodeURIComponent(name)}`)"
      />

      <SkillUploadDialog
        v-model:open="uploadOpen"
        @installed="
          (result) => {
            emit('announce', `SKILL ${result.name} 安装成功`)
            void loadList()
          }
        "
        @error="(message) => emit('announce', message)"
      />
    </template>
  </section>
</template>

<style scoped>
.skill-area__toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-4);
}
</style>
