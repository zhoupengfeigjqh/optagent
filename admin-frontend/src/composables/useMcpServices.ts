import { ref, shallowRef } from 'vue'
import {
  createMcpService,
  deleteMcpService,
  fetchMcpStats,
  getMcpService,
  listMcpServices,
  probeMcpTarget,
  saveMcpServiceConfig,
  testMcpService,
  type McpProbePayload,
} from '../api/mcp'
import type {
  ErrorInfo,
  McpProbeResult,
  McpServiceConfigPayload,
  McpServiceConfigSaved,
  McpServiceCreatePayload,
  McpServiceDetail,
  McpServiceListItem,
  McpStatsGroup,
  McpStatsItem,
  McpTestResult,
  Paged,
} from '../api/types'
import { toErrorInfo } from '../utils/error-message'

export function useMcpServices() {
  const page = ref(1)
  const list = shallowRef<Paged<McpServiceListItem> | null>(null)
  const detail = shallowRef<McpServiceDetail | null>(null)
  const stats = ref<McpStatsItem[]>([])
  const statsGroups = ref<McpStatsGroup[]>([])
  const statsAvailable = ref(true)
  const testResult = shallowRef<McpTestResult | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<ErrorInfo | null>(null)

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      list.value = await listMcpServices(page.value)
    } catch (err) {
      error.value = toErrorInfo(err)
    } finally {
      loading.value = false
    }
  }

  async function loadDetail(name: string): Promise<void> {
    error.value = null
    try {
      detail.value = await getMcpService(name)
    } catch (err) {
      error.value = toErrorInfo(err)
    }
  }

  async function loadStats(): Promise<void> {
    try {
      const res = await fetchMcpStats()
      statsAvailable.value = res.stats_available
      stats.value = res.items
      statsGroups.value = res.groups
    } catch {
      statsAvailable.value = false
      stats.value = []
      statsGroups.value = []
    }
  }

  async function createService(
    payload: McpServiceCreatePayload,
  ): Promise<McpServiceConfigSaved | null> {
    busy.value = true
    error.value = null
    try {
      return await createMcpService(payload)
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      busy.value = false
    }
  }

  async function probeTarget(payload: McpProbePayload): Promise<McpProbeResult | null> {
    busy.value = true
    error.value = null
    try {
      return await probeMcpTarget(payload)
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      busy.value = false
    }
  }

  async function saveConfig(
    name: string,
    payload: Omit<McpServiceConfigPayload, 'revision'>,
    revision?: number,
  ): Promise<{
    affected: string[]
    revision: number
    maskedHeaders: Record<string, string>
  } | null> {
    const currentRevision = revision ?? detail.value?.revision
    if (currentRevision === undefined) return null
    busy.value = true
    error.value = null
    try {
      const saved = await saveMcpServiceConfig(name, {
        ...payload,
        revision: currentRevision,
      })
      return {
        affected: saved.affected_agents,
        revision: saved.revision,
        maskedHeaders: saved.headers ?? {},
      }
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      busy.value = false
    }
  }

  async function removeService(name: string): Promise<boolean> {
    busy.value = true
    error.value = null
    try {
      await deleteMcpService(name)
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      return false
    } finally {
      busy.value = false
    }
  }

  async function runTest(name: string): Promise<McpTestResult | null> {
    busy.value = true
    error.value = null
    try {
      testResult.value = await testMcpService(name)
      return testResult.value
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      busy.value = false
    }
  }

  return {
    page,
    list,
    detail,
    stats,
    statsGroups,
    statsAvailable,
    testResult,
    loading,
    busy,
    error,
    loadList,
    loadDetail,
    loadStats,
    createService,
    probeTarget,
    saveConfig,
    removeService,
    runTest,
  }
}
