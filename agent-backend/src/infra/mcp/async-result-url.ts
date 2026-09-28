/**
 * MCP 异步工具的 `result_url` 注入（R11，契约 §10.2 / §10.6 不变式 1、2、6）。
 *
 * 与 `RUNTIME_CONTEXT_PARAMS`（`uid`/`sid`）**同一套路**：
 * - 判据取"**该工具自己的入参 schema 里声明了才注入**"——声明了就一定收到运行环境的值
 *   （覆盖模型填的任何内容），没声明的一个多余字段都不加（第三方服务常严格校验入参）；
 * - 该参数对 LLM **隐藏**（从暴露的 schema 里删掉）——模型无从填写，也就不可能幻觉出
 *   一个假的回写地址；
 * - 注入发生在 `execute` 内部、**HITL 挂起之后** ⇒ 签名 URL MUST NOT 出现在
 *   `interaction_request` 的 `proposed_args` 快照里（不变式 2）。
 *
 * 独立成文件的原因：`mcp-tool-adapter.ts` 已超 500 行门禁（**既有状态**，按宪章
 * 「不追溯」不在本次拆分，拆件任务已在 `tasks.md` 登记），新逻辑不再往里堆（原则二）。
 */

/** 异步工具的回写地址参数名（服务侧须在自己的 `inputSchema` 里声明它） */
export const ASYNC_RESULT_URL_PARAM = 'result_url';

/** JSON Schema 里我们关心的部分（只读） */
interface InputSchemaLike {
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

/** 该工具是否在自己的入参 schema 里声明了 `result_url` */
export function declaresResultUrl(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  const properties = (schema as InputSchemaLike).properties;
  if (typeof properties !== 'object' || properties === null) return false;
  return ASYNC_RESULT_URL_PARAM in (properties as Record<string, unknown>);
}

/**
 * 注入 `result_url`：值一律以运行环境为准，**覆盖模型填的任何内容**。
 *
 * 参数不是对象时原样返回（防御：MCP 入参本就应当是对象，异常形状交给服务端校验）；
 * `undefined` 视为空入参（与其他注入一致）。
 */
export function injectResultUrl(params: unknown, resultUrl: string): unknown {
  const base =
    typeof params === 'object' && params !== null
      ? { ...(params as Record<string, unknown>) }
      : params === undefined
        ? {}
        : null;
  if (base === null) return params;
  base[ASYNC_RESULT_URL_PARAM] = resultUrl;
  return base;
}

/**
 * 异步工具注入依赖（由 `agent-factory` 在**每次 run 装配工具时**传入）。
 *
 * 未声明 `async_tools` 的服务不传 ⇒ 走 `undefined` 分支 ⇒ 行为与改造前完全一致（不变式 1）。
 */
export interface AsyncToolContext {
  /** 该服务声明的异步工具名（**原始名**，不含 `{server}__` 前缀） */
  tools: readonly string[];
  /**
   * 铸造**该次调用**的回写地址。
   *
   * 每次调用现铸（而不是装配期铸一次）：一是 `exp` 从调用时刻起算、票面更新鲜，
   * 二是能把 `call_id`（工具调用 id）与 `tool`（运行环境侧全名）作为**归属提示参数**
   * 写进 URL —— 服务只需原样回传，产出即可接回具体对话与那一次调用（契约 §10.3）。
   */
  mintResultUrl: (toolName: string, toolCallId: string) => string;
}
