/**
 * 共享类型（domain 语义，不依赖 pi / Fastify / better-sqlite3）。
 */

/** 文件引用（@ 提及）：dir + filename 即文件地址 */
export interface FileReference {
  dir: string;
  filename: string;
}

/** 消息反馈取值（up=点赞 down=点踩 null=取消） */
export type FeedbackValue = 'up' | 'down' | null;

/** 请求级模型选择（结构与 config.ModelEntry 一致；domain 不反向依赖 config） */
export interface ModelSelection {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

/**
 * 对话消息（history.jsonl 落盘格式，仅 user/assistant 正文 + 元数据）。
 * 注意：不落思考内容与工具调用信息（spec 002 FR-006/009），故无相应字段。
 * 元数据字段均可选：旧格式行（仅 role/content）保持可读。
 */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  /** 消息唯一标识（线程内唯一），新行必含 */
  id?: string;
  /** ISO8601 时间戳 */
  ts?: string;
  /** 轮次状态（仅 assistant）；缺省视为 completed */
  status?: 'completed' | 'failed';
  /** 整轮 token 用量（仅 assistant 完成/失败轮） */
  usage?: { input_tokens: number; output_tokens: number };
  /** 整轮耗时（毫秒） */
  duration_ms?: number;
  /** @ 文件引用（仅 user） */
  attachments?: FileReference[];
  /**
   * 本轮对话使用的数字人（user 与 assistant 成对写入，取自当轮实例）。
   * 一个会话可跨多个数字人（切换后在下一轮生效），旧格式行缺省。
   */
  agent_name?: string;
  /** 失败轮错误信息（仅 status='failed'） */
  error?: { code: string; message: string };
}

/** LLM 流式事件（LlmProvider / agent-loop 输出） */
export type LlmEvent =
  | { type: 'thinking_delta'; delta: string }
  | { type: 'content_delta'; delta: string }
  /** 工具调用开始：仅工具名与调用标识，永不带入参 */
  | { type: 'tool_call_start'; callId: string; name: string }
  /** 工具调用结束：仅状态，永不带结果内容 */
  | { type: 'tool_call_end'; callId: string; status: 'success' | 'error' }
  | { type: 'done'; usage: UsageInfo }
  | { type: 'error'; code: string; message: string; usage?: UsageInfo };

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

/** 工具规格（传给 LLM 的工具声明） */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

/** Token 用量记录（usage.db / usage_records 表） */
export interface UsageRecord {
  id: number;
  userId: string;
  threadId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: string; // ISO8601
}

export interface UsageFilter {
  userId: string;
  threadId?: string;
  agentName?: string;
  from?: string; // ISO8601
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

/** UsageStore 接口（domain 定义，infra 实现） */
export interface UsageStore {
  record(entry: Omit<UsageRecord, 'id'>): void; // 失败记日志不抛出
  summary(filter: UsageFilter): UsageSummary;
  /**
   * MCP 工具调用计数（R4 / FR-049）：口径为**工具调用次数**，非 HTTP 请求数。
   * `userId` 为调用发起用户（2026-09-16 十四次调整：支撑按用户明细）；
   * 缺省/null 表示老数据未记录归属。
   */
  recordMcpCall(serviceName: string, ok: boolean, userId?: string | null): void;
  /** 按服务名的调用统计；未出现过的服务不在此列 */
  mcpCallStats(): McpCallStat[];
  close(): void;
}

/** MCP 服务调用统计（`contracts/runtime-api-delta.md` §4.3） */
/** 单个时间窗的调用计数（任务 2026-09-15：24h / 7 天 / 30 天 / 1 年） */
export interface McpCallWindow {
  ok: number;
  failed: number;
  total: number;
}

/** 单用户调用统计（2026-09-16 十四次调整：由事件明细按 user_id 聚合） */
export interface McpCallUserStat {
  /** 调用发起用户；`null` = 升级前的历史事件未记录归属 */
  user_id: string | null;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
}

export interface McpCallStat {
  name: string;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
  /** 按时间窗聚合（依赖每次调用的事件明细，事件只保留一年） */
  windows: {
    h24: McpCallWindow;
    d7: McpCallWindow;
    d30: McpCallWindow;
    d365: McpCallWindow;
  };
  /**
   * 按用户的调用明细（成功/失败分列）。数据来自事件明细表，故只覆盖
   * **最近一年**（与 windows 同口径）；未开过库的统计行可能为空数组。
   */
  users: McpCallUserStat[];
}

/** 实例池 key */
export interface PoolKey {
  userId: string;
  agentName: string;
}

/** 数字人配置包（agent-instance 产出） */
export interface AgentConfigBundle {
  agentName: string;
  systemPrompt: string;
  enabledTools: string[];
  mcpServers: McpServerConfig[];
  skills: SkillMeta[];
}

export interface SkillMeta {
  name: string;
  description: string;
}

/**
 * MCP 服务调用确认策略（人机交互门 HITL）：
 * - `never`：直接执行，不弹确认（默认，存量行为）
 * - `always`：该服务下全部工具调用前都需用户确认参数
 * - `{ tools: [...] }`：仅列出的工具名（**原始工具名**，不含 server 前缀）需确认
 */
export type McpConfirmation = 'never' | 'always' | { tools: string[] };

/** 文件参数转换模式（语法定义在 domain/file-arg-path.ts，两侧同构） */
import type { FileArgMode } from './domain/file-arg-path.js';
export type { FileArgMode };

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string; // stdio
  args?: string[];
  url?: string; // http
  /** 调用确认策略（缺省 `never`） */
  confirmation?: McpConfirmation;
  /**
   * 算法规则参数设置（可选）：`{ 工具名: 字段名 }`——该工具入参里承载
   * `array[object]` 规则清单的字段。声明后 HITL 确认窗中该字段旁出现
   * 「从算法规则选择」入口（读取「数据准备/算法规则」最新规则文件），
   * 由包装层把字段名带进 interaction 快照。装配时按**当前工具名**查本映射；
   * 空/缺省 = 不启用。不改变是否走 HITL（仍只由 confirmation 决定）。
   */
  rulesFields?: Record<string, string>;
  /** 声明该服务具备写能力（须配 permissionBoundary，FR-024） */
  write?: boolean;
  permissionBoundary?: string;
  /**
   * 文件参数声明：工具名 → { 取值路径: 转换模式 }。
   * 调用前由 backend 把 LLM 传入的相对路径（user-data 沙箱内）铸成签名直链，
   * 原参数位置换后发给服务；未声明的参数原样透传。
   * `"url:from=<路径>"` 为派生模式：目标字段由引擎从来源路径推导注入、
   * 覆盖模型填写，且该字段对 LLM 隐藏（防 http 地址幻觉）。
   */
  fileArgs?: Record<string, Record<string, FileArgMode>>;
}

/**
 * MCP 服务连接状态（HTTP 契约投影，002 FR-019）：
 * - `connected`：已建连可用
 * - `failed`：建连失败，实例已降级并标记该服务不可用
 * - `unknown`：尚无连接结果（实例未创建，或首次建连进行中）——不得误报为断线
 */
export type McpConnectionStatus = 'connected' | 'failed' | 'unknown';
