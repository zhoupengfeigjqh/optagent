import type { Logger } from 'pino';
import { ERROR_CODES } from '../error-codes.js';
import { ApiError } from '../api-error.js';
import type { McpServiceConfigService } from '../mcp/service-config.js';
import type { RuntimeClient, BuiltinToolProjection } from '../../infra/runtime-client.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import type { OntologyStore } from '../ontology/store.js';
import type { ReferenceIndex } from './reference-index.js';

export interface UnifiedCatalogDeps {
  runtime: RuntimeClient;
  mcpConfigs: McpServiceConfigService;
  skills: SkillLibraryService;
  ontologies: OntologyStore;
  logger?: Logger;
}

export interface CatalogSnapshot {
  index: ReferenceIndex;
  /** 运行环境不可达时的原因（`FR-011` 的降级信息；`null` 表示工具目录可得） */
  toolsUnavailableReason: string | null;
}

export class UnifiedCatalog {
  /**
   * 上次"工具目录不可得"的原因。
   *
   * 快照在每次保存校验/异常汇总时都会构建，**同一原因只告警一次**——
   * 否则运行环境不可达时会把同一句话刷满日志（实测：故障持续 5 小时留下 68 条重复告警）。
   * 恢复时补一条 info，让"什么时候好的"也有迹可循。
   */
  private lastToolsUnavailableReason: string | null = null;

  constructor(private readonly deps: UnifiedCatalogDeps) {}

  mcpServiceNames(): string[] {
    return this.deps.mcpConfigs.listAll().map((config) => config.name);
  }

  skillNames(): string[] {
    return [...this.deps.skills.names()];
  }

  ontologyKeys(): string[] {
    return this.deps.ontologies
      .listAll()
      .map((item) => `${item.metadata.scenario_name}/${item.metadata.ontology_name}`);
  }

  /** 内置工具目录（只读投影；不可达即抛 `ADM_RUNTIME_UNREACHABLE`） */
  async builtinTools(): Promise<BuiltinToolProjection[]> {
    return this.deps.runtime.builtinTools();
  }

  /**
   * 构建判据快照。
   *
   * **运行环境不可达时不抛错**：否则平台会因运行环境抖动而完全不可用。
   * 改为把原因带回（`toolsUnavailableReason`），由调用方决定——
   * 保存一个**引用了内置工具**的数字人时 MUST 拒绝（否则会把有效引用误判为失效），
   * 而保存一个不引用任何工具的数字人不应受影响。
   */
  async snapshot(): Promise<CatalogSnapshot> {
    let tools: string[] = [];
    let toolsUnavailableReason: string | null = null;
    try {
      tools = (await this.deps.runtime.builtinTools()).map((t) => t.name);
      if (this.lastToolsUnavailableReason !== null) {
        this.deps.logger?.info(
          { event: 'catalog.tools.recovered', previous_reason: this.lastToolsUnavailableReason },
          '内置工具目录已恢复可得',
        );
        this.lastToolsUnavailableReason = null;
      }
    } catch (err) {
      toolsUnavailableReason =
        err instanceof ApiError ? err.message : `运行环境不可达：${(err as Error).message}`;
      if (this.lastToolsUnavailableReason !== toolsUnavailableReason) {
        this.lastToolsUnavailableReason = toolsUnavailableReason;
        this.deps.logger?.warn(
          { event: 'catalog.tools.unavailable' },
          `内置工具目录不可得，本次按空清单处理：${toolsUnavailableReason}`,
        );
      }
    }

    return {
      index: {
        builtinTools: new Set(tools),
        mcpServices: new Set(this.mcpServiceNames()),
        skills: new Set(this.skillNames()),
        ontologies: new Set(this.ontologyKeys()),
        mcpTools: new Map(
          this.deps.mcpConfigs.listAll().map((config) => [config.name, new Set(config.allowed_tools)]),
        ),
      },
      toolsUnavailableReason,
    };
  }

  /**
   * 保存前的"工具目录必须可得"闸门：仅在本次提交**引用了内置工具**时要求
   * 目录可得——否则无法判断引用是否有效，宁可拒绝也不要误判（`FR-013`）。
   */
  static assertToolsAvailableFor(
    toolsUnavailableReason: string | null,
    enabledTools: readonly string[],
  ): void {
    if (toolsUnavailableReason && enabledTools.length > 0) {
      throw new ApiError(ERROR_CODES.ADM_RUNTIME_UNREACHABLE, toolsUnavailableReason);
    }
  }
}
