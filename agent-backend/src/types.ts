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
 *
 * 注意：**思考内容不落历史**（spec 002 FR-006/009），故无相应字段；
 * **工具调用记录不在此文件**——它落在同目录的 `tool-events.jsonl`
 * （元数据与结果），供刷新后展示与下一轮受控回灌，见 `domain/tool-events.ts`。
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
  /**
   * 工具调用开始：工具名 + 调用标识 + **入参短标量摘要**。
   *
   * 入参原文永不透出（可能含大 payload 或敏感信息）；摘要只留短标量，
   * 供展示"查了哪个文件/哪条记录"与审计（见 `domain/tool-result.ts` 的 digestArgs）。
   */
  | { type: 'tool_call_start'; callId: string; name: string; argsDigest?: Record<string, string> }
  /**
   * 工具调用结束：状态 + **已序列化的结果文本**。
   *
   * 结果文本由 `domain/tool-result.serializeToolResult` 拍平（图片块只留占位、
   * 不落 base64），会话内写入 `tool-events.jsonl`；是否外置成临时空间文件
   * 由体积阈值决定（见 `domain/tool-events.ts`）。SSE 仍只透出状态，不透出结果。
   */
  | { type: 'tool_call_end'; callId: string; name: string; status: 'success' | 'error'; resultText?: string }
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
   *
   * 2026-09-23：入参由位置参数改为事件对象——字段增至 6 个后位置参数已不可读，
   * 且与同接口的 `record(entry)` 保持同一风格。
   */
  recordMcpCall(entry: McpCallEvent): void;
  /** 服务级汇总 + 按「服务 × 工具 × 用户」的分组行；未出现过的服务不在此列 */
  mcpCallStats(): McpCallStats;
  close(): void;
}

/**
 * 一次 MCP **工具调用**的事件（2026-09-23：事件表扩列后的写入契约）。
 *
 * - 口径：每次 `tools/call` 记一条；**调用未发出**（如 file_args 校验失败）不记，
 *   与"计数 = 工具调用次数"的既定口径一致。
 * - `durationMs` 含 `McpManager` 内部的一次重试，即**用户感知耗时**，非单次尝试耗时。
 * - 字段名与运行日志的 `mcp.tool.call` 结构（`service`/`tool`/`ok`）对齐。
 */
export interface McpCallEvent {
  /** MCP 服务名（适配器里的 `serverName`） */
  service: string;
  /** 工具名（适配器里的 `t.name`，不含服务前缀） */
  tool: string;
  ok: boolean;
  /** 含重试的用户感知耗时（毫秒） */
  durationMs: number;
  /** 仅失败时有值 */
  errorKind?: McpCallErrorKind;
  /** 调用发起用户；缺省/null = 老数据未记录归属 */
  userId?: string | null;
  /** 当前会话 id（= `thread_id`），用于把事件接回具体对话 */
  threadId?: string | null;
}

/**
 * MCP 调用失败的**粗粒度**分类（2026-09-23）。
 *
 * 刻意不存错误原文（长度与脱敏不可控）：要细节去 pino 运行日志。
 * 判定复用 `McpManager` 既有的"连接级错误 vs `McpError`"规则，不在此处重新实现。
 */
export type McpCallErrorKind = 'unavailable' | 'protocol' | 'transport';

/** MCP 服务调用统计（`contracts/runtime-api-delta.md` §4.3） */
/** 单个时间窗的调用计数（任务 2026-09-15：24h / 7 天 / 30 天 / 1 年） */
export interface McpCallWindow {
  ok: number;
  failed: number;
  total: number;
}

/**
 * 服务级调用汇总（2026-09-23：时间窗已移到分组行，此处只留最近一年总量）。
 *
 * 供平台**卡片**展示"最近一年调用次数"；平台统计表的每一行是 `McpCallGroupStat`。
 * 计数口径为最近一年（独立累计表已删，改由只保留一年的事件明细聚合）。
 */
export interface McpCallStat {
  name: string;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
}

/**
 * 按「**服务 × 工具 × 用户**」分组的调用统计（2026-09-23）——平台统计表的**一行**。
 *
 * 时间窗放在这一层：每个组合都回答"最近 24h/7 天/30 天/一年各调了多少次、成功多少次"。
 * 更粗的视角（按服务、按用户）都能由它折叠而来，故不再单独提供。
 *
 * `tool_name` 是 **MCP 服务自己的工具名**（如 `ocr` 下的 `ocr_image`），
 * 不是暴露给模型的 `{server}__{tool}`；`tool_name` / `user_id` 为 `null` 表示
 * 升级前的历史事件未记录该维度（界面显示"未归属·升级前记录"）。
 */
export interface McpCallGroupStat {
  service: string;
  tool_name: string | null;
  user_id: string | null;
  calls_total: number;
  calls_ok: number;
  calls_failed: number;
  last_called_at: string | null;
  /** 四个时间窗（数据源同为事件明细，故都覆盖在"最近一年"这一保留期内） */
  windows: {
    h24: McpCallWindow;
    d7: McpCallWindow;
    d30: McpCallWindow;
    d365: McpCallWindow;
  };
}

/** `UsageStore.mcpCallStats()` 的返回：一次聚合同时给出服务级汇总与分组行 */
export interface McpCallStats {
  items: McpCallStat[];
  groups: McpCallGroupStat[];
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
   * 算法规则参数设置（可选）：`{ 工具名: 字段名或对象路径 }`——该工具入参里承载
   * `array[object]` 规则清单的字段。声明后 HITL 确认窗中该字段旁出现
   * 「从算法规则选择」入口（读取「数据准备/算法规则」最新规则文件），
   * 由包装层把路径带进 interaction 快照。
   *
   * 路径支持对象嵌套（如 `input.targetPriorities`，2026-09-22）——规则数组常在入参
   * 对象内部，只认顶层字段名会让这类声明**静默失效**。写法与判据见
   * `domain/rules-field-path.ts`。
   *
   * 装配时按**当前工具名**查本映射；空/缺省 = 不启用。
   * 不改变是否走 HITL（仍只由 confirmation 决定）。
   */
  rulesFields?: Record<string, string>;
  /**
   * 异步工具声明（R11，2026-09-25）：列出**该服务自己的原始工具名**（不含 `{server}__` 前缀）。
   *
   * 声明后，运行环境在调用这些工具时注入 `result_url`（签名写直链，见
   * `infra/file-sign.ts` 的 `mintPutUrl`），服务算完把结果回写到用户空间
   * `临时空间/后台产出/`。**不改变工具是否同步、也不改变是否走 HITL**——
   * 只是给被声明的工具多注入一个回写地址。
   *
   * 缺省/空 = 不启用（存量行为零变化）。
   */
  asyncTools?: string[];
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
