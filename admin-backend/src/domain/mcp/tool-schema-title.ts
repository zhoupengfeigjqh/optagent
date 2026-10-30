/**
 * MCP 工具入参 schema 的**根标题视图**（2026-10-30，方案 A）。
 *
 * 为什么需要：MCP 服务端（FastMCP / Pydantic）会给入参模型自动生成根 `title`，
 * 值是一个类名（`ocr_imageArguments`）——对人没有意义，却占着"标题"这个位置。
 * 真正的标题是服务端在 `@mcp.tool(title="图片识别")` 里声明的 `Tool.title`。
 *
 * 三条规则（**只动根节点**）：
 * 1. 服务端声明了 `Tool.title` → 删根 `title`，写 `x-title` 为该值；
 *    用 `x-` 前缀是因为 JSON Schema 允许未知关键字，平台不伪造标准关键字。
 * 2. 服务端**未声明** → **原样透传**：此时根 `title` 是唯一信息，
 *    改名成 `x-title: xxxArguments` 会让"`x-title` = 人读标题"的约定失真。
 * 3. `properties` / `items` 里的 `title` **一律不动**：运行环境的 HITL 表单
 *    用字段级 `title` 作标签，管理端的映射表也按 `properties` 递归枚举。
 *
 * 与运行环境同一条口径（`agent-backend/src/infra/mcp/mcp-schema-view.ts` 的
 * `withServerTitleX`）：两侧是独立部署的服务、没有共享包，故各留一份实现，
 * 语义必须逐字一致——管理端「入参说明」看到的形状要与模型/弹窗看到的一致。
 */

/** JSON Schema 里我们关心的部分（只读） */
interface SchemaLike {
  title?: unknown;
  [key: string]: unknown;
}

/**
 * 把根 `title` 换成 `x-title`（值 = 服务端 `Tool.title`）。
 *
 * @param schema MCP `tools/list` 返回的 `inputSchema`（原样，未经平台裁剪）
 * @param serverTitle 服务端声明的工具标题（`Tool.title`），缺省 / 空白即不改动
 */
export function withServerTitleX(schema: unknown, serverTitle?: string): unknown {
  const title = typeof serverTitle === 'string' ? serverTitle.trim() : '';
  if (title === '') return schema;
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema;
  const next = { ...(schema as SchemaLike) };
  delete next.title;
  next['x-title'] = title;
  return next;
}
