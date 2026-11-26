import type { InteractionRequestPayload } from './interaction-gate.js';
import type { NextActionsView } from './next-actions.js';
import type { HistoryErrorInfo } from '../types.js';

export type RunState = 'running' | 'draining' | 'done' | 'aborted' | 'error';

export type ResolveInteractionResult =
  | { ok: true; result: 'settled' | 'already-resolved' }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'EXPIRED' | 'VALIDATION_FAILED';
      message: string;
      errors?: string[];
    };

export type SsePayload =
  | { type: 'thinking'; data: { delta: string } }
  | { type: 'content'; data: { delta: string } }
  | {
      type: 'tool_call';
      data: { call_id: string; name: string; label?: string; status: 'running' };
    }
  | { type: 'tool_call_end'; data: { call_id: string; status: 'success' | 'error' } }
  /**
   * 计划进度（028 FR-034）：**单行进度条的唯一数据源**。
   *
   * 只承载当前步的编号 / 步名 / 三态，MUST NOT 携带计划正文、失败原因或工具结果；
   * 前端不得据此渲染完整步骤列表（默认折叠，展开只列已出现的步）。
   * 本轮结束即失效，不落盘、不进历史（刷新不恢复）。
   */
  | {
      type: 'plan_progress';
      data: { seq_id: number; label: string; phase: 'running' | 'replanned' | 'done' };
    }
  | { type: 'interaction_request'; data: InteractionRequestPayload }
  | {
      type: 'done';
      data: {
        finish_reason: 'stop' | 'completed';
        usage: { input_tokens: number; output_tokens: number };
        duration_seconds: number;
        message_id: string | null;
        /** 本轮回答的数字人（009 起会话归属固定；逐条标注保留以兼容存量数据） */
        agent_name: string;
        next_actions?: NextActionsView;
      };
    }
  | {
      type: 'error';
      data: {
        error: HistoryErrorInfo;
        duration_seconds?: number;
        usage?: { input_tokens: number; output_tokens: number };
        /** 本轮回答的数字人（009 起会话归属固定；逐条标注保留以兼容存量数据） */
        agent_name: string;
      };
    };
