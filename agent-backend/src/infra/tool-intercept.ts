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

export function wrapToolWithInteraction(
  tool: AgentTool,
  sink: InteractionSink,
  rulesField?: string,
): AgentTool {
  return {
    ...tool,
    /**
     * HITL 工具强制串行执行（pi 的 per-tool 覆盖；批次内任一 sequential 工具 ⇒ 整批串行）。
     * 原因：并行批次里多个需确认调用会**同时**挂起（gate 支持并发，maxPending=3），
     * 而前端交互弹窗是单槽位——后到的 interaction_request 覆盖先到的，被覆盖的挂起点
     * 在 UI 不可达也不可操作，run 的 Promise.all 要等它超时（300s）才推进，
     * 表现为「提交弹窗后界面卡死，刷新才看到下一个」（2026-09-19 实踩）。
     * 串行化保证任意时刻最多一个挂起点；代价是同批工具不再并行——HITL 场景下
     * 「一个接一个确认」本来就是更合理的交互语义。
     */
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

      // 规则字段声明仅在**本工具 schema 确实含该字段**时下发——避免给无关工具的快照
      // 注入无意义声明（配置是服务级的，工具是服务内多个之一的常见形态）
      const hasRulesField =
        rulesField !== undefined &&
        typeof schema.properties === 'object' &&
        schema.properties !== null &&
        rulesField in (schema.properties as Record<string, unknown>);

      const outcome = await sink.request({
        callId: toolCallId,
        toolName: tool.name,
        toolDescription: tool.description,
        schema,
        proposedArgs: proposed,
        ...(hasRulesField ? { rulesField } : {}),
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
