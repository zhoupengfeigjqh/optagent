/**
 * 异步工具判据（2026-10-03）。
 *
 * **判据与运行环境完全一致**：`agent-backend/src/infra/mcp/async-result-url.ts` 的
 * `declaresResultUrl()` 就是"该工具自己的入参 schema 的 `properties` 里有没有
 * `result_url`"——平台注入回写地址的唯一开关（《异步MCP服务接入约定.md》§2.1 硬规则 1）。
 *
 * 界面用它把「后台计算（异步工具）」的可选项**收敛到真正支持异步的工具**：
 * 不含该参数的工具勾了也不会生效（运行期只产生一条告警），列出来只会误导。
 *
 * 放在 `utils/` 而非组件内：判据要被多个选择器/提示复用，且有单测（原则三）。
 */

/** 异步工具的回写地址参数名（服务侧须在自己的 `inputSchema` 里声明它） */
export const ASYNC_RESULT_URL_PARAM = 'result_url'

/** JSON Schema 里我们关心的部分（只读） */
interface InputSchemaLike {
  properties?: Record<string, unknown>
}

/** 该工具的入参 schema 是否声明了 `result_url`（与服务侧约定、运行期注入同一判据） */
export function hasResultUrl(parameters: unknown): boolean {
  if (typeof parameters !== 'object' || parameters === null) return false
  const properties = (parameters as InputSchemaLike).properties
  if (typeof properties !== 'object' || properties === null) return false
  return ASYNC_RESULT_URL_PARAM in properties
}
