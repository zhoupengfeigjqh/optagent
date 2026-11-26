<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import {
  fetchOntology,
  listOntologies,
  type OntologyDetail,
  type OntologyListItem,
  type OntologyWriteResult,
} from '../../api/ontologies'
import type { ErrorInfo, Paged } from '../../api/types'
import { ontologyDisplayName } from '../../utils/ontology-name'
import OntologyCardList from './OntologyCardList.vue'
import OntologyMarketDialog from './OntologyMarketDialog.vue'
import OntologyViewer from './OntologyViewer.vue'

const props = defineProps<{
  detail: string | null
  tab: string | null
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
const ontologyDetail = ref<OntologyDetail | null>(null)
const marketOpen = ref(false)

function detailPath(scenarioName: string, ontologyName: string): string {
  return `/ontology/${encodeURIComponent(scenarioName)}/${encodeURIComponent(ontologyName)}`
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

async function loadDetail(scenario: string, ontologyName: string): Promise<void> {
  error.value = null
  try {
    ontologyDetail.value = await fetchOntology(scenario, ontologyName)
  } catch (err) {
    error.value = err as ErrorInfo
  }
}

function open(target: { scenario: string; ontologyDir: string }): void {
  emit('navigate', detailPath(target.scenario, target.ontologyDir))
}

function onImported(result: OntologyWriteResult): void {
  emit('announce', `本体 ${ontologyDisplayName(result)} 已从本体市场导入`)
  void loadList()
}

function onUpdated(result: OntologyWriteResult): void {
  emit('announce', `本体 ${ontologyDisplayName(result)} 已更新为市场现版本`)
  void loadList()
}

onMounted(() => {
  void loadList()
  if (props.detail && props.scenario) void loadDetail(props.scenario, props.detail)
})

watch(
  () => [props.detail, props.scenario] as const,
  ([ontologyName, scenarioName]) => {
    if (ontologyName && scenarioName) void loadDetail(scenarioName, ontologyName)
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
