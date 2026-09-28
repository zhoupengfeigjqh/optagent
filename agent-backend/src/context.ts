/**
 * 应用上下文（wiring）：server.ts 装配，routes 消费。
 * 独立成文件避免 routes ↔ server 循环 import。
 */
import type { AppConfig } from './config.js';
import type { AgentPool } from './domain/agent-pool.js';
import type { CurrentAgentStore } from './domain/current-agent.js';
import type { HistoryStore } from './domain/history.js';
import type { McpStatusEvents } from './domain/mcp-events.js';
import type { ProducedEvents } from './domain/produced-events.js';
import type { RunManager } from './domain/run-manager.js';
import type { SummaryStore } from './domain/summary.js';
import type { ThreadStore } from './domain/thread-store.js';
import type { ToolEventStore } from './domain/tool-events.js';
import type { ChatAgent } from './infra/agent-factory.js';
import type { AppLoggers } from './logging.js';
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
  runManager: RunManager;
  usage: UsageStore;
  /** MCP 状态变更总线：建连落定 / 选中变化时发出，SSE 路由据此推送快照 */
  mcpEvents: McpStatusEvents;
  /** 后台产出变更总线（R11）：MCP 服务回写落盘后发出，SSE 路由据此推"可能已变"信号 */
  producedEvents: ProducedEvents;
  /** 池命中返回缓存实例；未命中装配新实例入池（池满抛 PoolExhaustedError） */
  getOrCreateAgent(key: PoolKey): Promise<ChatAgent>;
}
