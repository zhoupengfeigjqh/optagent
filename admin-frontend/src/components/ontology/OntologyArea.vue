<script setup lang="ts">
/**
 * 本体管理功能区（`FR-058`~`FR-061`，2026-10-03）：只读浏览 + 本体市场导入/更新/删除。
 *
 * 结构照 `SkillArea`：列表 ↔ 详情两级（`FR-053` 的导航深度上限），工具栏在列表右上角
 * 提供「从本体市场导入」入口。
 *
 * **身份是两段**：`detail` 是本体目录名，场景名在路由查询参数里（`?scenario=`）——
 * 同名的本体目录可以存在于不同场景。因此本组件比其他 Area 多一个 `scenario` prop，
 * 由 `App.vue` 从 `route.query` 传入（仅本组件声明，不影响其它功能区）。
 */
import { onMounted, ref, watch } from 'vue'
import {
  fetchOntology,
  listOntologies,
  type OntologyDetail,
  type OntologyListItem,
  type OntologyWriteResult,
} from '../../api/ontologies'
import type { ErrorInfo, Paged } from '../../api/types'
import OntologyCardList from './OntologyCardList.vue'
import OntologyMarketDialog from './OntologyMarketDialog.vue'
import OntologyViewer from './OntologyViewer.vue'

const props = defineProps<{
  detail: string | null
  tab: string | null
  /** 详情所属场景（路由查询参数 `scenario`） */
  scenario: string | null
}>()

const emit = defineEmits<{
  (e: 'navigate', path: string): void
  (e: 'announce', text: string): void
}>()

const page = ref(1)
const list = ref<Paged<OntologyListItem> | null>(null)
const error = ref<ErrorInfo | null>(null)
const loading = ref(false)
/** 当前打开的本体详情（与 props.detail 同名会与路由参数混淆，故显式改名） */
const ontologyDetail = ref<OntologyDetail | null>(null)
const marketOpen = ref(false)

/** 详情路径：本体目录名 + 场景名（两段身份在 URL 上各归其位） */
function detailPath(ontologyDir: string, scenario: string): string {
  return `/ontology/${encodeURIComponent(ontologyDir)}?scenario=${encodeURIComponent(scenario)}`
}

async function loadList(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    list.value = await listOntologies(page.value)
  } catch (err) {
    error.value = err as ErrorInfo
  } finally {
    loading.value = false
  }
}

async function loadDetail(ontologyDir: string, scenario: string): Promise<void> {
  error.value = null
  try {
    ontologyDetail.value = await fetchOntology(ontologyDir, scenario)
  } catch (err) {
    error.value = err as ErrorInfo
  }
}

/** 卡片「查看」：先改地址栏（可刷新、可分享），由 watch 触发加载 */
function open(target: { scenario: string; ontologyDir: string }): void {
  emit('navigate', detailPath(target.ontologyDir, target.scenario))
}

function onImported(result: OntologyWriteResult): void {
  emit('announce', `本体 ${result.name} 已从本体市场导入`)
  void loadList()
}

function onUpdated(result: OntologyWriteResult): void {
  emit('announce', `本体 ${result.name} 已更新为市场现版本`)
  void loadList()
}

onMounted(() => {
  void loadList()
  if (props.detail && props.scenario) void loadDetail(props.detail, props.scenario)
})

watch(
  () => [props.detail, props.scenario] as const,
  ([ontologyDir, scenario]) => {
    if (ontologyDir && scenario) void loadDetail(ontologyDir, scenario)
    else {
      ontologyDetail.value = null
      void loadList()
    }
  },
)
</script>

<template>
  <section class="ontology-area">
    <OntologyViewer
      v-if="ontologyDetail"
      :ontology="ontologyDetail"
      :error="error"
      @back="
        () => {
          ontologyDetail = null
          emit('navigate', '/ontology')
        }
      "
      @deleted="
        () => {
          ontologyDetail = null
          emit('announce', '本体已删除')
          emit('navigate', '/ontology')
          void loadList()
        }
      "
    />

    <template v-else>
      <div class="ontology-area__toolbar">
        <button type="button" class="btn" @click="marketOpen = true">从本体市场导入</button>
      </div>

      <OntologyCardList
        :items="list?.items ?? []"
        :total="list?.total ?? 0"
        :page="page"
        :loading="loading"
        :error="error"
        @update:page="
          (next) => {
            page = next
            void loadList()
          }
        "
        @open="open"
      />

      <OntologyMarketDialog
        v-model:open="marketOpen"
        @imported="onImported"
        @updated="onUpdated"
        @error="(message) => emit('announce', message)"
      />
    </template>
  </section>
</template>

<style scoped>
.ontology-area__toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: var(--space-4);
}
</style>
