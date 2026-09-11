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
  close(): void;
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

export interface McpServerConfig {
  name: string;
  transport: 'stdio' | 'http';
  command?: string; // stdio
  args?: string[];
  url?: string; // http
  /** 声明该服务具备写能力（须配 permissionBoundary，FR-024） */
  write?: boolean;
  permissionBoundary?: string;
}
