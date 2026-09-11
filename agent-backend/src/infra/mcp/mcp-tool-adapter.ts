/**
 * MCP tool → pi-agent-core AgentTool 适配（T021）。
 *
 * - 工具名 `{server}__{tool}`，避免多 server 重名冲突
 * - 调用经 McpManager（30s 超时 + 重试 1 次）
 * - McpUnavailableError 不抛出：以自然语言降级提示作为工具结果返回，
 *   Agent 在 content 中说明"当前服务不可用，请稍后尝试"（FR-024，不走 SSE error）
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { McpManager, McpToolInfo } from './mcp-manager.js';
import { McpUnavailableError } from './mcp-manager.js';

export function mcpToolsAsAgentTools(manager: McpManager, serverName: string, tools: McpToolInfo[]): AgentTool[] {
  return tools.map((t) => ({
    name: `${serverName}__${t.name}`,
    label: `${serverName}: ${t.name}`,
    description: t.description ?? '',
    // MCP inputSchema 是 JSON Schema，与 typebox 结构兼容；直接透传
    parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as never,
    execute: async (_toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      try {
        const result = await manager.callTool(serverName, t.name, params);
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
