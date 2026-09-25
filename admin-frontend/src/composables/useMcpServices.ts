/**
 * MCP 服务管理（US4）：列表、详情、调用配置、启停、测试、日志与统计。
 *
 * 统计的呈现口径（`FR-009`）：`stats_available=false` 表示**读不到**，
 * 界面 MUST 显示"未知"，MUST NOT 以 0 冒充——0 是"确实没调用过"的确定结论。
 */
import { ref, shallowRef } from 'vue'
import {
  fetchMcpLogs,
  fetchMcpStats,
  getMcpService,
  listMcpServices,
  saveMcpServiceConfig,
  startMcpService,
  stopMcpService,
  testMcpService,
} from '../api/mcp'
import type {
  ErrorInfo,
  McpLogLine,
  McpServiceConfigPayload,
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
  /** 按「服务 × 工具 × 用户」分组的统计行（2026-09-23；统计表的行） */
  const statsGroups = ref<McpStatsGroup[]>([])
  const statsAvailable = ref(true)
  const logs = ref<McpLogLine[]>([])
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

  async function loadLogs(name: string, limit = 50): Promise<void> {
    error.value = null
    try {
      logs.value = (await fetchMcpLogs(name, limit)).items
    } catch (err) {
      error.value = toErrorInfo(err)
    }
  }

  /**
   * 保存调用配置。
   *
   * `revision` **显式传入**：详情页持有的是父组件加载的 props，本实例的
   * `detail` 可能从未加载——早期实现 `if (!detail.value) return null` 会让
   * 详情页的保存**永远静默失败**（实测缺陷，2026-09-15 修复）。
   * 兼容旧调用：不传时仍回退到本实例已加载的 detail。
   *
   * **不再 `loadDetail`**（2026-09-25，契约 §0.5 原则 ②）：保存响应本身即
   * "保存后的**完整**调用配置"（含新 `revision`），回填所需的一切都在里面。
   * 二次请求详情还会连带触发一次 MCP 服务的**实时探测**（§3.2 的工具清单），
   * 探测抖动会让界面上依赖清单的渲染分支（复选框清单 ⇄ 手填文本框）来回切换
   * ——这是"保存时闪一下"的第二个来源。返回 `revision` 供调用方**原地更新**，
   * 从而保证下一次保存不报 `ADM_CONFIG_REVISION_CONFLICT`。
   */
  async function saveConfig(
    name: string,
    payload: Omit<McpServiceConfigPayload, 'revision'>,
    revision?: number,
  ): Promise<{ affected: string[]; revision: number } | null> {
    const currentRevision = revision ?? detail.value?.revision
    if (currentRevision === undefined) return null
    busy.value = true
    error.value = null
    try {
      const saved = await saveMcpServiceConfig(name, {
        ...payload,
        revision: currentRevision,
      })
      return { affected: saved.affected_agents, revision: saved.revision }
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      busy.value = false
    }
  }

  async function setRunning(name: string, running: boolean): Promise<boolean> {
    busy.value = true
    error.value = null
    try {
      if (running) await startMcpService(name)
      else await stopMcpService(name)
      await loadDetail(name)
      await loadList()
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
    logs,
    testResult,
    loading,
    busy,
    error,
    loadList,
    loadDetail,
    loadStats,
    loadLogs,
    saveConfig,
    setRunning,
    runTest,
  }
}
