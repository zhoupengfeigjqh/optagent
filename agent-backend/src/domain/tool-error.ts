/**
 * 工具失败的**统一标记通道**（2026-10-29）。
 *
 * 为什么不是 `throw`：
 * - pi 的 loop 捕获异常后会用 `createErrorToolResult(message)` **覆盖**整个结果——
 *   `content` 只剩一句 message，`details` 被置为 `{}`。想保留的结构化信息全丢。
 * - 异常控制流把"业务失败"与"程序缺陷"压成一条路，日志上无从区分。
 *
 * 因此工具层**一律不抛**，只在 `details.toolError` 打标记；由
 * `infra/agent-loop.ts` 注入的 `afterToolCall` 统一翻成 `isError: true`
 * （`patch.isError` 是 pi 的官方通道，见 `finalizeExecutedToolCall`）。
 *
 * 语义边界（2026-10-29 与产品口径对齐）：
 * - 工具**正常执行**但业务不如人意（库存不足、无匹配、模拟被拒）→ 普通文本，不标记，卡片绿。
 * - 工具**catch 到异常** / HITL 拒绝、超时、本轮中断 → 标记，卡片红。
 *
 * `isError` 只影响 UI：pi-ai 的 OpenAI 兼容转换（DeepSeek 走这条）不读该字段，
 * 模型看到的仍是同一段 content 文案——所以"标红"不会诱导模型重试，
 * 权限拒绝类结果里的自愈引导照旧生效。
 */
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

/** 标记里的错误信息：`code` 供日志/审计/未来前端扩展，`message` 与 content 正文同源 */
export interface ToolErrorInfo {
  code: string;
  message: string;
}

/** `details` 上承载标记的字段名（内部约定，不落盘、不进 LLM 载荷） */
export const TOOL_ERROR_DETAILS_KEY = 'toolError';

/**
 * 构造一个"失败"工具结果：正文给人读文案，`details` 带标记。
 *
 * `message` 同时进 content 与 details——content 是模型与卡片正文的唯一来源，
 * 两者必须同源，否则展开看到的与模型读到的会对不上。
 */
export function toolErrorResult(message: string, code: string): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: message }],
    details: { [TOOL_ERROR_DETAILS_KEY]: { code, message } },
  };
}

/**
 * 从 `details` 里读标记；任何不符合形状的输入一律 `undefined`。
 *
 * 防御是必须的：`details` 是 `unknown`，历史版本/第三方工具可能塞任意值，
 * 这里一旦抛错就会让 `afterToolCall` 整条降级（SDK 会把正常结果覆盖成 error）。
 */
export function readToolError(details: unknown): ToolErrorInfo | undefined {
  try {
    if (typeof details !== 'object' || details === null) return undefined;
    const raw = (details as Record<string, unknown>)[TOOL_ERROR_DETAILS_KEY];
    if (typeof raw !== 'object' || raw === null) return undefined;
    const { code, message } = raw as { code?: unknown; message?: unknown };
    if (typeof code !== 'string' || code === '' || typeof message !== 'string') return undefined;
    return { code, message };
  } catch {
    // 取值器抛错的对象也算脏数据——本函数的契约是"永不抛"
    return undefined;
  }
}

/**
 * `afterToolCall` 的实现体：有标记就翻成 `isError: true`，没有就放行。
 *
 * MUST 不抛。hook 抛错时 pi 会**覆盖**结果为 error（`finalizeExecutedToolCall` 的 catch），
 * 正常结果会被误伤成失败——所以 `readToolError` 之外的任何意外都在这里兜住。
 */
export function markToolError(result: unknown): { isError: true } | undefined {
  try {
    if (typeof result !== 'object' || result === null) return undefined;
    const error = readToolError((result as { details?: unknown }).details);
    return error === undefined ? undefined : { isError: true };
  } catch {
    return undefined;
  }
}
