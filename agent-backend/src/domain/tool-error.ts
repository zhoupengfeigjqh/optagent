import type { AgentToolResult } from '@earendil-works/pi-agent-core';

export interface ToolErrorInfo {
  code: string;
  message: string;
}

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

export function appendToolText(
  result: AgentToolResult<unknown>,
  text: string,
): AgentToolResult<unknown> {
  const content = Array.isArray(result.content) ? result.content : [];
  return { ...result, content: [...content, { type: 'text', text }] };
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
    return undefined;
  }
}

export function markToolError(result: unknown): { isError: true } | undefined {
  try {
    if (typeof result !== 'object' || result === null) return undefined;
    const error = readToolError((result as { details?: unknown }).details);
    return error === undefined ? undefined : { isError: true };
  } catch {
    return undefined;
  }
}
