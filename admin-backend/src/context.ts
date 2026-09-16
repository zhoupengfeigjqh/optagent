/**
 * 应用上下文（wiring）：`server.ts` 装配，`routes/` 消费。
 *
 * 独立成文件以避免 `routes ↔ server` 循环 import，与 `agent-backend` 同构。
 */
import type { AppConfig } from './config.js';
import type { AgentDesignService } from './domain/config-center/agent-design.js';
import type { UnifiedCatalog } from './domain/config-center/unified-catalog.js';
import type { UserLinkService } from './domain/config-center/user-links.js';
import type { Deployer } from './domain/deploy/deployer.js';
import type { DeployHistoryService } from './domain/deploy/history.js';
import type { DeployManifestService } from './domain/deploy/manifest.js';
import type { McpServiceConfigService } from './domain/mcp/service-config.js';
import type { McpServiceListService } from './domain/mcp/service-list.js';
import type { McpServiceOperations } from './domain/mcp/operations.js';
import type { PlatformSettingsService } from './domain/platform-settings.js';
import type { SkillLibraryService } from './domain/skill-library/install.js';
import type { ComposeReader } from './infra/compose-reader.js';
import type { DockerHost } from './infra/docker-host.js';
import type { OptAgentWriter } from './infra/opt-agent-writer.js';
import type { PlatformStore } from './infra/platform-store.js';
import type { RuntimeClient } from './infra/runtime-client.js';
import type { AppLoggers } from './logging.js';

export interface AppContext {
  config: AppConfig;
  loggers: AppLoggers;

  /* ---- infra：数据访问与宿主资源 ---- */
  /** 平台设计态存储（唯一权威源，`research.md` D4） */
  store: PlatformStore;
  /** 容器编排声明（只读投影，`FR-043`） */
  compose: ComposeReader;
  /** 宿主机 Docker（只读查询 + 白名单内启停，`research.md` D3） */
  docker: DockerHost;
  /** 运行环境只读端点客户端（`plan.md` R2/R4） */
  runtime: RuntimeClient;

  /* ---- domain：业务服务 ---- */
  /** 平台级设置（目标运行形态，`FR-056`） */
  settings: PlatformSettingsService;
  /** 数字人设计态（`FR-014`~`FR-022`） */
  agents: AgentDesignService;
  /** 用户与关联数字人（`FR-023`~`FR-025`） */
  users: UserLinkService;
  /** 共享技能库（`FR-035`~`FR-042`） */
  skills: SkillLibraryService;
  /** MCP 调用配置（`FR-044`） */
  mcpConfigs: McpServiceConfigService;
  /** MCP 服务清单投影（`FR-043`、`FR-052`） */
  mcpServices: McpServiceListService;
  /** MCP 启停/测试/日志/统计（`FR-046`~`FR-050`） */
  mcpOperations: McpServiceOperations;
  /** 部署清单（`FR-031`） */
  manifest: DeployManifestService;
  /** 部署历史（`FR-033`） */
  history: DeployHistoryService;
  /** `.opt-agent` 物化写入（原子、整体覆盖） */
  writer: OptAgentWriter;
  /** 统一清单装配（`FR-019` 的判据来源） */
  catalog: UnifiedCatalog;
  /** 部署编排（`FR-026`~`FR-034`） */
  deployer: Deployer;
}
