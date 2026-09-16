/**
 * MCP 传输方式的归一（2026-09-16）。
 *
 * **背景**：运行环境连接 MCP 用的是 MCP SDK 的 **Streamable HTTP** 传输
 * （`infra/mcp/mcp-manager.ts` 里 `transport !== 'stdio'` 即走
 * `StreamableHTTPClientTransport`）。历史文档与平台侧把这个值写作 `http`，
 * 而 MCP 生态（以及我们界面上的文案）普遍称它为 `streamable-http`。
 *
 * 手工把 `MCP.json` 里的 `http` 改成 `streamable-http` 时，会撞上
 * "transport 须为 stdio|http" 而**整个数字人被排除在列表外**（实测报错）。
 * 二者本就是指同一件事，因此这里接受这两种（及下划线/无分隔符写法），
 * 并在入口处**归一为 `http`**——让规范取值只有一种，
 * 避免"同一语义两种取值"扩散到比较、物化、日志与界面各处。
 */

/** 规范取值：`http` 即 Streamable HTTP */
export type McpTransport = 'http' | 'stdio';

/** 错误提示里给用户看的可接受取值（含别名） */
export const MCP_TRANSPORT_HINT = 'http（streamable-http）或 stdio';

/** 归一传输方式；不认识的写法返回 `null`（由调用方决定如何报错） */
export function normalizeTransport(value: unknown): McpTransport | null {
  if (typeof value !== 'string') return null;
  switch (value.trim().toLowerCase()) {
    // `streamable-http` 是 MCP 生态的通用叫法；下划线/无分隔符写法一并容忍（同一语义的常见变体）
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
