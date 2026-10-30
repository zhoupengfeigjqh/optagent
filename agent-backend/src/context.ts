/**
 * 应用上下文（wiring）：server.ts 装配，routes 消费。
 * 独立成文件避免 routes ↔ server 循环 import。
 */
import type { AppConfig } from './config.js';
import type { AgentPool } from './domain/agent-pool.js';
import type { CurrentAgentStore } from './domain/current-agent.js';
import type { HistoryStore } from './domain/history.js';
import type { McpStatusEvents } from './domain/mcp-events.js';
import type { NextActionsStore } from './domain/next-actions.js';
import type { ProducedEvents } from './domain/produced-events.js';
import type { RunManager } from './domain/run-manager.js';
import type { SummaryStore } from './domain/summary.js';
import type { ThreadStore } from './domain/thread-store.js';
import type { ToolEventStore } from './domain/tool-events.js';
import type { ChatAgent } from './infra/agent-factory.js';
import type { AppLoggers } from './logging.js';
import type { ScheduledTasksBundle } from './server-schedule.js';
import type { PoolKey, UsageStore } from './types.js';

export interface AppContext {
  config: AppConfig;
  loggers: AppLoggers;
  pool: AgentPool;
  currentAgent: CurrentAgentStore;
  threadStore: ThreadStore;
  history: HistoryStore;
  summary: SummaryStore;
  /** 工具调用记录（002 特性）：详情接口挂卡片 + 懒加载外置正文 */
  toolEvents: ToolEventStore;
  /** 下一步动作提示（007）：轮末生成 + 会话级单快照读取（新端点据此下发） */
  nextActions: NextActionsStore;
  runManager: RunManager;
  usage: UsageStore;
  /** MCP 状态变更总线：建连落定 / 选中变化时发出，SSE 路由据此推送快照 */
  mcpEvents: McpStatusEvents;
  /** 后台产出变更总线（R11）：MCP 服务回写落盘后发出，SSE 路由据此推"可能已变"信号 */
  producedEvents: ProducedEvents;
  /**
   * 定时任务（015）：任务存储 / 运行记录 / 变更信号 / 心跳 / 执行器。
   *
   * 打包成一个字段而不是四个：这五者共享同一份 `ScheduledTask` 视图与同一批路径，
   * 由 `server-schedule.ts` 一次装配，路由只需 `ctx.scheduled.store` 这类读取，
   * 不会出现"路由自己 new 一个 store"的第二份实例。
   */
  scheduled: ScheduledTasksBundle;
  /** 池命中返回缓存实例；未命中装配新实例入池（池满抛 PoolExhaustedError） */
  getOrCreateAgent(key: PoolKey): Promise<ChatAgent>;
}
