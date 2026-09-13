/**
 * MCP tool → pi-agent-core AgentTool 适配（T021）。
 *
 * - 工具名 `{server}__{tool}`，避免多 server 重名冲突
 * - 调用经 McpManager（30s 超时 + 重试 1 次）
 * - McpUnavailableError 不抛出：以自然语言降级提示作为工具结果返回，
 *   Agent 在 content 中说明"当前服务不可用，请稍后尝试"（FR-024，不走 SSE error）
 * - file_args 声明（可选）：LLM 传 user-data 相对路径，经 FileAccess 沙箱校验后
 *   原参数位置换为签名直链发给服务（远程/跨容器服务无磁盘访问权）
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { FileAccess } from '../../domain/file-access.js';
import type { McpManager, McpToolInfo } from './mcp-manager.js';
import { McpUnavailableError } from './mcp-manager.js';

/** 文件参数转换依赖（按 server 声明启用；agent-factory 按当前用户注入） */
export interface FileArgContext {
  fileAccess: FileAccess;
  userId: string;
  mintUrl: (userId: string, relPath: string) => string;
}

export function mcpToolsAsAgentTools(
  manager: McpManager,
  serverName: string,
  tools: McpToolInfo[],
  fileArgs?: Record<string, Record<string, 'url'>>,
  fileCtx?: FileArgContext,
): AgentTool[] {
  return tools.map((t) => ({
    name: `${serverName}__${t.name}`,
    label: `${serverName}: ${t.name}`,
    description: t.description ?? '',
    // MCP inputSchema 是 JSON Schema，与 typebox 结构兼容；直接透传
    parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as never,
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      let finalParams: unknown;
      try {
        finalParams = rewriteFileArgs(t.name, params, fileArgs, fileCtx);
      } catch (err) {
        // 沙箱校验拒绝（路径越权/文件不存在）：作为工具结果返回，Agent 可自我纠正
        return {
          content: [{ type: 'text', text: `文件参数校验失败：${err instanceof Error ? err.message : String(err)}` }],
          details: {},
        };
      }
      try {
        const result = await manager.callTool(serverName, t.name, finalParams);
        const text = typeof result === 'string' ? result : JSON.stringify(result);
        return { content: [{ type: 'text', text }], details: {} };
      } catch (err) {
        if (err instanceof McpUnavailableError) {
          return {
            content: [{ type: 'text', text: `外部服务 ${serverName} 当前不可用，请稍后尝试` }],
            details: {},
          };
        }
        throw err;
      }
    },
  }));
}

/** 命中 file_args 声明的参数：相对路径的值原位置换为签名 URL；沙箱拒绝时抛 PermissionError */
function rewriteFileArgs(
  toolName: string,
  params: unknown,
  fileArgs?: Record<string, Record<string, 'url'>>,
  fileCtx?: FileArgContext,
): unknown {
  const decl = fileArgs?.[toolName];
  if (!decl || !fileCtx || typeof params !== 'object' || params === null) return params;
  const obj = { ...(params as Record<string, unknown>) };
  for (const param of Object.keys(decl)) {
    const value = obj[param];
    // 参数缺失/非字符串：不转换，交给服务端自身校验
    if (typeof value !== 'string' || !value) continue;
    const { relPath } = fileCtx.fileAccess.resolveVerified(value); // 越权抛 PermissionError
    obj[param] = fileCtx.mintUrl(fileCtx.userId, relPath);
  }
  return obj;
}
