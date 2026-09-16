/**
 * MCP 传输方式的归一（2026-09-16）——与 `agent-backend/src/domain/mcp-transport.ts` 同构。
 *
 * 平台侧存的规范值是 `http`（界面文案显示为 `streamable-http`，物化到 `MCP.json`
 * 的也是 `http`）。但管理员手工编辑 `mcp-services.json` 时，很可能按生态习惯写成
 * `streamable-http`；运行环境侧已接受该别名，平台侧若拒绝保存就会造成
 * "能手工改文件、却保存不进平台"的不一致。因此这里同样**入口归一为 `http`**。
 */

/** 规范取值：`http` 即 Streamable HTTP */
export type McpTransport = 'http' | 'stdio';

/** 错误提示里给用户看的可接受取值（含别名） */
export const MCP_TRANSPORT_HINT = 'http（streamable-http）或 stdio';

/** 归一传输方式；不认识的写法返回 `null`（由调用方决定如何报错） */
export function normalizeTransport(value: unknown): McpTransport | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    case 'http':
    case 'streamable-http':
    case 'streamable_http':
    case 'streamablehttp':
      return 'http';
    case 'stdio':
      return 'stdio';
    default:
      return null;
  }
}
