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
  toolEvents: ToolEventStore;
  nextActions: NextActionsStore;
  runManager: RunManager;
  usage: UsageStore;
  mcpEvents: McpStatusEvents;
  producedEvents: ProducedEvents;
  scheduled: ScheduledTasksBundle;
  getOrCreateAgent(key: PoolKey): Promise<ChatAgent>;
}
