/**
 * MCP 连通性测试（「发起测试」与「创建后自动测一次」共用的**同一条路径**）。
 *
 * 抽出来的原因（2026-10-08）：`McpCallConfigForm` 触了 500 行门禁（宪章原则二），
 * 而这段与"表单字段"无关——它只关心"取表单当前值 → 调测试接口 → 弹结果"。
 *
 * 调用方负责两件事：
 * 1. 提供**表单当前值**的连接目标（允许未保存）——测的必须是管理员正在编辑的地址，
 *    而不是上一次保存的旧值（实测缺陷，2026-09-15）；
 * 2. `beforeTest` 里做本地校验（如请求头 JSON 写法）：返回可读错误即中止，不发请求。
 */
import { ref, type Ref } from 'vue'
import { testMcpService, type McpProbePayload } from '../api/mcp'
import type { ErrorInfo, McpTestResult } from '../api/types'

export interface McpConnectionTestOptions {
  /** 已登记服务名（测试端点只接受已登记的服务） */
  serviceName: () => string
  /** 表单当前值（允许未保存） */
  target: () => McpProbePayload
  /** 测试前的本地校验：返回非空字符串即中止，并把它作为可读报错呈现 */
  beforeTest?: () => string | null
  /** 本地校验失败时的落点（表单内的错误区） */
  onLocalError: (message: string | null) => void
  /** 结果播报（成功/失败/请求失败各一句） */
  announce: (text: string) => void
}

export interface McpConnectionTest {
  result: Ref<McpTestResult | null>
  busy: Ref<boolean>
  error: Ref<ErrorInfo | null>
  /** 结果弹窗实例（调用方在模板上挂 `ref`） */
  dialog: Ref<{ open: () => void } | null>
  run: () => Promise<void>
}

export function useMcpConnectionTest(opts: McpConnectionTestOptions): McpConnectionTest {
  const result = ref<McpTestResult | null>(null)
  const busy = ref(false)
  const error = ref<ErrorInfo | null>(null)
  const dialog = ref<{ open: () => void } | null>(null)

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
      opts.announce(
        result.value.ok ? '连通性与能力验证均通过' : '测试未通过，详见弹窗中的失败原因',
      )
    } catch (err) {
      error.value = err as ErrorInfo
      opts.announce('测试请求失败')
    } finally {
      busy.value = false
      dialog.value?.open()
    }
  }

  return { result, busy, error, dialog, run }
}
