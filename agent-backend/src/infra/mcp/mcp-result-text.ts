/**
 * MCP 工具结果 → 交给模型与落盘的那份**文本**（2026-10-12）。
 *
 * 为什么单独成文件：`mcp-tool-adapter.ts` 已超 500 行门禁（**既有状态**，见
 * `async-result-url.ts` 头注释），新逻辑不再往里堆（宪章原则二）。
 *
 * 改之前的口径与代价（2026-10-12 实踩，工具 `hd-algorithm__hd_algorithm_input_parser`）：
 * 适配器把**整个** MCP `CallToolResult` 用 `JSON.stringify` 成一个 text 块，于是
 * ① 服务返回的业务正文被压成"**字符串里的 JSON**"——`extractViewLinks` 只递归对象/数组、
 *    不二次解析字符串，`viewUrl` 因此抽不到（回答尾部没有入口行）；前端"结构化查看"
 *    只看到一个信封；模型还要多解一层；
 * ② `type:'image'` 块的 base64 随信封进入结果文本，绕过 `serializeToolResult` 的占位保护
 *    （落盘膨胀、token 浪费）。
 *
 * 现在的口径：**文本生成规则仍只有一处实现**（`domain/tool-result.ts` 的
 * `serializeToolResult`——模型可见与落盘共用同一份），本模块只补它做不了的三件事：
 * ① 形状分发：字符串结果原样返回（旧行为不变，且无需扫描）；
 * ② 可观测：把 `serializeToolResult` **不认识**的块类型上报成结构化 warn
 *    （宪章原则九：降级不许静默——`audio` / `resource_link` / 内嵌 resource 会被跳过，
 *    与"不落 base64"同一取舍）；
 * ③ 历史兼容：`unwrapMcpEnvelopeText()` 识别旧记录里的"整体序列化信封"
 *    （**仅供一次性回填脚本**，运行时不走它）。
 *
 * 边界：不改写块内容、不拼前缀、不解析业务 JSON（那是 `view-links` 与前端展示层的事）；
 * "一个块都认不出来"时退回 JSON 兜底——宁可多一层字符串，也不丢信息。
 */
import type { Logger } from 'pino';

import { serializeToolResult } from '../../domain/tool-result.js';

/**
 * `serializeToolResult` 认识的块类型。
 *
 * 改这里 MUST 同时改 `domain/tool-result.ts`：两处不一致时，要么漏报（可观测失效），
 * 要么把能处理的块误报成"不支持"。
 */
const SUPPORTED_BLOCK_TYPES = new Set(['text', 'image']);

/** 不支持块的告警落点（缺省 = 不扫描、不告警） */
export interface UnsupportedBlockLog {
  /** 运行日志（已绑定 user / agent / thread 的那一个） */
  logger?: Logger | undefined;
  /** MCP 服务名（日志字段：便于定位是哪个服务返回的怪东西） */
  service: string;
  /** 工具名（同上） */
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

/**
 * 旧记录兼容：把"整体序列化信封"文本还原成**内层正文**（2026-10-12）。
 *
 * **仅供一次性回填脚本**（`scripts/backfill-view-links.ts`）使用：新记录不再产生信封，
 * 运行时链路不调用它，因此**不构成第二套抽取规则**。
 *
 * 判据收得很窄（避免变成"任意字符串都试着解析"的第二个漂移点）：文本是合法 JSON **对象**、
 * 含 `content` 数组、且**至少有一块** `{type:'text', text:字符串}`；命中才把 text 块按 `\n`
 * 拼起来返回，否则 `undefined`（调用方按原文本处理）。
 */
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

/** 块的 `type` 字段（非对象 / 非字符串类型 → `undefined`，一并视作"不支持"） */
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

/** 上报被跳过的块（没有日志落点时不扫描：不为打日志而遍历） */
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
