import type { Logger } from 'pino';

import { serializeToolResult } from '../../domain/tool-result.js';

const SUPPORTED_BLOCK_TYPES = new Set(['text', 'image']);

export interface UnsupportedBlockLog {
  logger?: Logger | undefined;
  service: string;
  tool: string;
}

/**
 * MCP 工具结果 → 结果文本。
 *
 * - 字符串结果：**原样**返回（旧行为不变）
 * - 其余：`serializeToolResult()` 的文本（text 块拼接 / image 块转体积占位 / 认不出就 JSON 兜底），
 *   并先把它的实现**不认识**的块类型报出来
 */
export function mcpResultText(result: unknown, log?: UnsupportedBlockLog): string {
  if (typeof result === 'string') return result;
  reportUnsupportedBlocks(result, log);
  return serializeToolResult(result).text;
}

export function unwrapMcpEnvelopeText(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const blocks = contentBlocksOf(parsed);
  if (blocks === undefined) return undefined;

  const texts: string[] = [];
  for (const block of blocks) {
    if (blockTypeOf(block) !== 'text') continue;
    const value = (block as { text?: unknown }).text;
    if (typeof value === 'string') texts.push(value);
  }
  return texts.length > 0 ? texts.join('\n') : undefined;
}

/** 取出 `content` 块数组；不是该形状则 `undefined`（调用方走 JSON 兜底） */
function contentBlocksOf(result: unknown): unknown[] | undefined {
  if (result === null || typeof result !== 'object') return undefined;
  const content = (result as { content?: unknown }).content;
  return Array.isArray(content) ? content : undefined;
}

function blockTypeOf(block: unknown): string | undefined {
  if (block === null || typeof block !== 'object') return undefined;
  const type = (block as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

/**
 * `serializeToolResult` 会**跳过**的块：类型不认识，或 text 块的 `text` 不是字符串。
 *
 * 判据与它的实现一一对应：它只认 `text`（且 `text` 必须是字符串）与 `image` 两种。
 */
function isSkippedBySerializer(block: unknown): boolean {
  const type = blockTypeOf(block);
  if (type === undefined || !SUPPORTED_BLOCK_TYPES.has(type)) return true;
  if (type === 'text') return typeof (block as { text?: unknown }).text !== 'string';
  return false;
}

function reportUnsupportedBlocks(result: unknown, log?: UnsupportedBlockLog): void {
  if (log === undefined) return;
  const blocks = contentBlocksOf(result);
  if (blocks === undefined) return;

  for (const block of blocks) {
    if (!isSkippedBySerializer(block)) continue;
    const blockType = blockTypeOf(block) ?? '未知';
    log.logger?.warn(
      {
        alert: true,
        event: 'mcp.result.block_unsupported',
        service: log.service,
        tool: log.tool,
        block_type: blockType,
      },
      `MCP 工具结果含平台不支持的块类型，已跳过：${blockType}`,
    );
  }
}
