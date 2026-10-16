/**
 * Run 事件与状态类型（002 特性拆分：run-manager 单文件 ≤500 行，宪章原则二）。
 *
 * 这些类型是 **domain（广播）↔ routes（SSE 下发）** 之间的契约，与
 * `contracts/backend-api.md` §4.2 同构；独立成模块后 run-manager 只保留生命周期逻辑。
 * `run-manager.ts` 仍会 re-export 本模块的导出，既有引用路径不变。
 */
import type { InteractionRequestPayload } from './interaction-gate.js';
import type { HistoryErrorInfo } from '../types.js';

export type RunState = 'running' | 'draining' | 'done' | 'aborted' | 'error';

/** resolveInteraction 的结果（路由层映射 HTTP 状态码） */
export type ResolveInteractionResult =
  | { ok: true; result: 'settled' | 'already-resolved' }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'EXPIRED' | 'VALIDATION_FAILED';
      message: string;
      errors?: string[];
    };

/** 广播给订阅者的事件（与 SSE 契约同构） */
export type SsePayload =
  | { type: 'thinking'; data: { delta: string } }
  | { type: 'content'; data: { delta: string } }
  | { type: 'tool_call'; data: { call_id: string; name: string; status: 'running' } }
  | { type: 'tool_call_end'; data: { call_id: string; status: 'success' | 'error' } }
  /** 工具调用前的人工确认请求（HITL）：仅含被声明为需确认的工具 */
  | { type: 'interaction_request'; data: InteractionRequestPayload }
  | {
      type: 'done';
      data: {
        finish_reason: 'stop' | 'completed';
        usage: { input_tokens: number; output_tokens: number };
        duration_seconds: number;
        /** assistant 落盘消息 ID；stop（本轮丢弃）时为 null */
        message_id: string | null;
        /** 本轮回答的数字人（009 起会话归属固定；逐条标注保留以兼容存量数据） */
        agent_name: string;
        /**
         * 007 修订（Tail Protocol）：本轮的「下一步动作提示」卡片。
         * 卡片与回答同流产出，`done` 时已就绪，故随事件直推（前端不再轮询拉取）。
         * 无卡片（开关关闭 / 模型未输出块 / 解析失败）时字段缺省。
         */
        next_actions?: {
          message_id: string;
          actions: Array<{
            prompt: string;
            tools: Array<{
              kind: 'builtin' | 'mcp';
              name: string;
              service?: string;
              exposed_name: string;
            }>;
            guidance: string;
          }>;
        };
      };
    }
  | {
      type: 'error';
      data: {
        /**
         * 失败原因；2026-10-15 起 `error` 可带三个**可选**诊断字段
         * （`upstream_status` / `upstream_type` / `request_id`，见 §19.3），
         * 与失败轮落盘行**同形**（同一个 `classifyLlmFailure()` 的产物）。
         */
        error: HistoryErrorInfo;
        duration_seconds?: number;
        usage?: { input_tokens: number; output_tokens: number };
        /** 本轮回答的数字人（009 起会话归属固定；逐条标注保留以兼容存量数据） */
        agent_name: string;
      };
    };
