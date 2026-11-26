import { ref, type Ref } from 'vue'
import { testMcpService, type McpProbePayload } from '../api/mcp'
import type { ErrorInfo, McpTestResult } from '../api/types'

export interface McpConnectionTestOptions {
  serviceName: () => string
  target: () => McpProbePayload
  beforeTest?: () => string | null
  onLocalError: (message: string | null) => void
  announce: (text: string) => void
  dialog: Ref<{ open: () => void } | null>
}

export interface McpConnectionTest {
  result: Ref<McpTestResult | null>
  busy: Ref<boolean>
  error: Ref<ErrorInfo | null>
  run: () => Promise<void>
}

export function useMcpConnectionTest(opts: McpConnectionTestOptions): McpConnectionTest {
  const result = ref<McpTestResult | null>(null)
  const busy = ref(false)
  const error = ref<ErrorInfo | null>(null)

  async function run(): Promise<void> {
    opts.onLocalError(null)
    const invalid = opts.beforeTest?.() ?? null
    if (invalid !== null) {
      opts.onLocalError(invalid)
      return
    }

    busy.value = true
    error.value = null
    try {
      result.value = await testMcpService(opts.serviceName(), opts.target())
      opts.announce(result.value.ok ? '连通性与能力验证均通过' : '测试未通过，详见弹窗中的失败原因')
    } catch (err) {
      error.value = err as ErrorInfo
      opts.announce('测试请求失败')
    } finally {
      busy.value = false
      opts.dialog.value?.open()
    }
  }

  return { result, busy, error, run }
}
