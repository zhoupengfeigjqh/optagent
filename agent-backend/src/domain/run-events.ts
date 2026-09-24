/**
 * Run 事件与状态类型（002 特性拆分：run-manager 单文件 ≤500 行，宪章原则二）。
 *
 * 这些类型是 **domain（广播）↔ routes（SSE 下发）** 之间的契约，与
 * `contracts/backend-api.md` §4.2 同构；独立成模块后 run-manager 只保留生命周期逻辑。
 * `run-manager.ts` 仍会 re-export 本模块的导出，既有引用路径不变。
 */
import type { InteractionRequestPayload } from './interaction-gate.js';

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
        /** 本轮回答的数字人（会话可跨数字人） */
        agent_name: string;
      };
    }
  | {
      type: 'error';
      data: {
        error: { code: string; message: string };
        duration_seconds?: number;
        usage?: { input_tokens: number; output_tokens: number };
        /** 本轮回答的数字人（会话可跨数字人） */
        agent_name: string;
      };
    };
