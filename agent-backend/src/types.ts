
export interface FileReference {
  dir: string;
  filename: string;
}

export type FeedbackValue = 'up' | 'down' | null;

export interface ModelSelection {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  id?: string;
  ts?: string;
  status?: 'completed' | 'failed';
  usage?: { input_tokens: number; output_tokens: number };
  /** 整轮耗时（毫秒） */
  duration_ms?: number;
  attachments?: FileReference[]
  skill?: string;
  agent_name?: string;
  error?: HistoryErrorInfo;
}

export interface HistoryErrorInfo {
  code: string;
  message: string;
  upstream_status?: number;
  upstream_type?: string;
  request_id?: string;
  details?: string[];
  reason?: 'unregistered' | 'condition_false' | 'config_unavailable';
}

export type LlmEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'content_delta'; delta: string }
  | {
      type: 'tool_call_start';
      callId: string;
      name: string;
      argsDigest?: Record<string, string>;
      label?: string;
    }
  | {
      type: 'tool_call_end';
      callId: string;
      name: string;
      status: 'success' | 'error';
      resultText?: string;
    }
  /**
   * 计划进度（028 FR-034）：**单行**进度，只带当前步。
   *
   * 不进历史、不落盘；`seqId` 在重规划后可跳变（滚动规划的正常形态）。
   */
  | { type: 'plan_progress'; seqId: number; label: string; phase: 'running' | 'replanned' | 'done' }
  | { type: 'done'; usage: UsageInfo }
  | ({
      type: 'error';
      usage?: UsageInfo;
    } & HistoryErrorInfo);

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

export interface RuntimeToolBrief {
  name: string;
  description: string;
}

export interface RunRuntime {
  availableTools: RuntimeToolBrief[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface UsageRecord {
  id: number;
  userId: string;
  threadId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export interface UsageFilter {
  userId: string;
  threadId?: string;
  agentName?: string;
  from?: string;
  to?: string;
}

export interface UsageSummary {
  total: { inputTokens: number; outputTokens: number; count: number };
  grouped: Array<{
    threadId: string;
    agentName: string;
    inputTokens: number;
    outputTokens: number;
    count: number;
  }>;
}

export interface UsageStore {
  record(entry: Omit<UsageRecord, 'id'>): void;
  summary(filter: UsageFilter): UsageSummary;
  /**
   * MCP 工具调用计数（R4 / FR-049）：口径为**工具调用次数**，非 HTTP 请求数。
   *
   * 2026-09-23：入参由位置参数改为事件对象——字段增至 6 个后位置参数已不可读，
   * 且与同接口的 `record(entry)` 保持同一风格。
   */
  recordMcpCall(entry: McpCallEvent): void;
  mcpCallStats(): McpCallStats;
  close(): void;
}

export interface McpCallEvent {
  service: string;
  tool: string;
  ok: boolean;
  /** 含重试的用户感知耗时（毫秒） */
  durationMs: number;
  errorKind?: McpCallErrorKind;
  userId?: string | null;
  threadId?: string | null;
}

/**
 * MCP 调用失败的**粗粒度**分类（2026-09-23）。
 *
 * 刻意不存错误原文（长度与脱敏不可控）：要细节去 pino 运行日志。
 * 判定复用 `McpManager` 既有的"连接级错误 vs `McpError`"规则，不在此处重新实现。
 */
export type McpCallErrorKind = 'unavailable' | 'protocol' | 'transport';

export interface McpCallWindow {
  ok: number;
  failed: number;
  total: number;
}

export interface McpCallStat {
  name: string;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
}

export interface McpCallGroupStat {
  service: string;
  tool_name: string | null;
  user_id: string | null;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
  windows: {
    h24: McpCallWindow;
    d7: McpCallWindow;
    d30: McpCallWindow;
    d365: McpCallWindow;
  };
}

export interface McpCallStats {
  items: McpCallStat[];
  groups: McpCallGroupStat[];
}

export interface PoolKey {
  userId: string;
  agentName: string;
}

export interface AgentConfigBundle {
  agentName: string;
  soulBody: string;
  systemPrompt: string;
  enabledTools: string[];
  mcpServers: McpServerConfig[];
  skills: SkillMeta[];
}

export interface SkillMeta {
  name: string;
  description: string;
}

export type McpConfirmation = 'never' | 'always' | { tools: string[] };

import type { FileArgMode } from './domain/file-arg-path.js';
export type { FileArgMode };

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  confirmation?: McpConfirmation;
  rulesFields?: Record<string, string>;
  allowedTools?: string[];
  toolLabels?: Record<string, string>;
  write?: boolean;
  permissionBoundary?: string;
  fileArgs?: Record<string, Record<string, FileArgMode>>;
}

/**
 * MCP 服务连接状态（HTTP 契约投影，002 FR-019）：
 * - `connected`：已建连可用
 * - `failed`：建连失败，实例已降级并标记该服务不可用
 * - `unknown`：尚无连接结果（实例未创建，或首次建连进行中）——不得误报为断线
 */
export type McpConnectionStatus = 'connected' | 'failed' | 'unknown';
