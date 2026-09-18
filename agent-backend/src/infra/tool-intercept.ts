/**
 * 工具交互包装器（HITL）：给 AgentTool.execute 包一层"人工确认门"。
 *
 * 包装后行为：
 * - execute 被调用时先经 InteractionSink 挂起，向前端发 interaction_request
 *   （schema 取工具声明的可见入参 schema，预填值取模型本次传入的 args）
 * - 用户 submit → 用**用户确认后的 args** 调真实 execute（file_args 改写、
 *   uid/sid 注入等下游处理全部照旧发生在被包装的原 execute 里，安全层不绕过）
 * - 用户 reject / 超时 / run 中断 → 不调真实实现，返回 isError 的 toolResult，
 *   模型读到「用户拒绝了本次调用」后自行组织收尾话术（业界 HITL 标准做法）
 *
 * 解耦红线：本文件不含任何具体工具/MCP 服务名；包装与否由 MCP.json 的
 * confirmation 策略决定（agent-factory 装配时判定）。
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { InteractionSink } from '../domain/interaction-gate.js';

export function wrapToolWithInteraction(tool: AgentTool, sink: InteractionSink): AgentTool {
  return {
    ...tool,
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const schema =
        typeof tool.parameters === 'object' && tool.parameters !== null
          ? (tool.parameters as Record<string, unknown>)
          : { type: 'object', properties: {} };
      const proposed =
        typeof params === 'object' && params !== null && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};

      const outcome = await sink.request({
        callId: toolCallId,
        toolName: tool.name,
        schema,
        proposedArgs: proposed,
      });

      if (outcome.kind !== 'submit') {
        const reason = outcome.kind === 'expired' ? '等待超时，调用未执行' : '用户拒绝了本次调用';
        return {
          content: [{ type: 'text', text: `${reason}：${tool.name}` }],
          details: {},
        };
      }
      return tool.execute(toolCallId, outcome.args);
    },
  };
}
