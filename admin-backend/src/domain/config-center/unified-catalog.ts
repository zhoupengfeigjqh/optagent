/**
 * 统一清单装配（`FR-019` 的判据来源）。
 *
 * 数字人三类引用的可选范围来自三个**不同性质**的来源：
 * | 引用类型 | 来源 | 性质 |
 * |---|---|---|
 * | 内置工具 | 运行环境 `GET /api/builtin-tools` | 只读投影（`FR-011`） |
 * | MCP 服务 | 容器编排声明 | 只读投影（`FR-043`） |
 * | SKILL | 共享技能库索引 | 平台设计态（`FR-036`） |
 *
 * 本模块把三者收拢为一个 `ReferenceIndex` 快照，供**保存校验、异常判定、
 * 部署前校验**共用同一份判据——避免三处各自取数导致结论不一致。
 */
import type { Logger } from 'pino';
import { ERROR_CODES } from '../error-codes.js';
import { ApiError } from '../api-error.js';
import type { ComposeReader } from '../../infra/compose-reader.js';
import type { RuntimeClient, BuiltinToolProjection } from '../../infra/runtime-client.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import type { ReferenceIndex } from './reference-index.js';

export interface UnifiedCatalogDeps {
  runtime: RuntimeClient;
  compose: ComposeReader;
  skills: SkillLibraryService;
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

  /** MCP 服务名（编排声明的唯一来源，`FR-043`） */
  mcpServiceNames(): string[] {
    return this.deps.compose.listMcpServices().map((s) => s.name);
  }

  /** SKILL 名（共享技能库） */
  skillNames(): string[] {
    return [...this.deps.skills.names()];
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
      // 状态变化才记（同一原因重复出现不再刷日志，见字段注释）
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
