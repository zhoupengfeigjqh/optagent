import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';

import type { InteractionSink } from '../domain/interaction-gate.js';
import { hasRulesFieldPath } from '../domain/rules-field-path.js';
import { toolErrorResult } from '../domain/tool-error.js';

export function wrapToolWithInteraction(
  tool: AgentTool,
  sink: InteractionSink,
  rulesField?: string,
): AgentTool {
  return {
    ...tool,
    executionMode: 'sequential',
    execute: async (toolCallId: string, params: unknown): Promise<AgentToolResult<unknown>> => {
      const schema =
        typeof tool.parameters === 'object' && tool.parameters !== null
          ? (tool.parameters as Record<string, unknown>)
          : { type: 'object', properties: {} };
      const proposed =
        typeof params === 'object' && params !== null && !Array.isArray(params)
          ? (params as Record<string, unknown>)
          : {};

      // 规则字段声明仅在**本工具 schema 里确实走得通**时下发——避免给无关工具的快照
      const hasRulesField = rulesField !== undefined && hasRulesFieldPath(schema, rulesField);

      const outcome = await sink.request({
        callId: toolCallId,
        toolName: tool.name,
        ...(typeof tool.label === 'string' && tool.label !== '' ? { toolLabel: tool.label } : {}),
        toolDescription: tool.description,
        schema,
        proposedArgs: proposed,
        ...(hasRulesField ? { rulesField } : {}),
      });

      if (outcome.kind !== 'submit') {
        // 三种未执行的原因**文案必须各自准确**：中断不是用户的决定，
        let reason = '用户拒绝了本次调用';
        let code = 'HITL_REJECTED';
        if (outcome.kind === 'expired') {
          reason = '等待超时，调用未执行';
          code = 'HITL_EXPIRED';
        } else if (outcome.reason === 'aborted') {
          reason = '本轮已中断，调用未执行';
          code = 'HITL_ABORTED';
        }
        return toolErrorResult(`${reason}：${tool.name}`, code);
      }
      return tool.execute(toolCallId, outcome.args);
    },
  };
}
