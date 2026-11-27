import type { AppConfig } from './config.js';
import type { AuthService } from './domain/auth/service.js';
import type { SessionStore } from './domain/auth/session-store.js';
import type { AgentDesignService } from './domain/config-center/agent-design.js';
import type { UnifiedCatalog } from './domain/config-center/unified-catalog.js';
import type { UserLinkService } from './domain/config-center/user-links.js';
import type { Deployer } from './domain/deploy/deployer.js';
import type { DeployHistoryService } from './domain/deploy/history.js';
import type { DeployManifestService } from './domain/deploy/manifest.js';
import type { McpServiceConfigService } from './domain/mcp/service-config.js';
import type { McpServiceListService } from './domain/mcp/service-list.js';
import type { OntologyStore } from './domain/ontology/store.js';
import type { McpServiceOperations } from './domain/mcp/operations.js';
import type { SkillLibraryService } from './domain/skill-library/install.js';
import type { OptAgentWriter } from './infra/opt-agent-writer.js';
import type { PlatformStore } from './infra/platform-store.js';
import type { RuntimeClient } from './infra/runtime-client.js';
import type { AppLoggers } from './logging.js';

export interface AppContext {
  config: AppConfig;
  loggers: AppLoggers;

  store: PlatformStore;
  runtime: RuntimeClient;

  agents: AgentDesignService;
  users: UserLinkService;
  skills: SkillLibraryService;
  ontologies: OntologyStore;
  mcpConfigs: McpServiceConfigService;
  mcpServices: McpServiceListService;
  mcpOperations: McpServiceOperations;
  manifest: DeployManifestService;
  history: DeployHistoryService;
  /** `.opt-agent` 物化写入（原子、整体覆盖） */
  writer: OptAgentWriter;
  catalog: UnifiedCatalog;
  deployer: Deployer;
  sessionStore: SessionStore;
  auth: AuthService;
}
