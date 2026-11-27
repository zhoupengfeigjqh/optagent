import type { Logger } from 'pino';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { AgentDesignDocument, AgentDesignService } from '../config-center/agent-design.js';
import type { UserLinkPort } from '../config-center/user-links.js';
import type { McpServiceConfigService } from '../mcp/service-config.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import type { OntologyStore } from '../ontology/store.js';
import type { DeployHistoryService, DeployUserRecord } from './history.js';
import type { DeployManifestService, ManifestDiffEntry } from './manifest.js';
import { buildUserArtifacts, type MaterializeContext } from './materialize.js';
import type { OptAgentWriter } from '../../infra/opt-agent-writer.js';
import type { PlatformStore } from '../../infra/platform-store.js';

export interface DeployTarget {
  user_id: string;
  agents: string[];
}
export interface DeployerDeps {
  store: PlatformStore;
  agents: AgentDesignService;
  users: UserLinkPort;
  mcpConfigs: McpServiceConfigService;
  skills: SkillLibraryService;
  ontologies: OntologyStore;
  writer: OptAgentWriter;
  manifest: DeployManifestService;
  history: DeployHistoryService;
  logger: Logger;
}

export interface DeployRunResult {
  users: DeployUserRecord[];
  manifest_diff: ManifestDiffEntry[];
  history_id: string;
}

export interface DeployWithdrawResult {
  user_id: string;
  withdrawn: string[];
}

export class Deployer {
  constructor(private readonly deps: DeployerDeps) {}

  get manifest(): DeployManifestService {
    return this.deps.manifest;
  }

  get history(): DeployHistoryService {
    return this.deps.history;
  }

  async deploy(userIds: string[] | undefined, revision: number): Promise<DeployRunResult> {
    this.deps.store.assertRevision(revision);
    const targets = this.resolveTargets(userIds);

    const context: MaterializeContext = {
      mcpConfigs: this.deps.mcpConfigs,
      skills: this.deps.skills,
      ontologies: this.deps.ontologies,
      // 017：术语字典降级告警与部署其余告警同一出口
      logger: this.deps.logger,
    };

    const results: DeployUserRecord[] = [];
    const diffs: ManifestDiffEntry[] = [];
    const startedAt = Date.now();

    for (const target of targets) {
      diffs.push(
        ...this.deps.manifest.diff(
          target.user_id,
          target.agents,
          this.deps.writer.listAgents(target.user_id),
        ),
      );
    }

    // 关键行为日志（任务 2026-09-15）：部署是平台最重的写操作，起止必须留痕
    this.deps.logger.info(
      {
        event: 'deploy.begin',
        users: targets.map((t) => t.user_id),
        agent_count: targets.reduce((sum, t) => sum + t.agents.length, 0),
        diff_count: diffs.length,
      },
      `开始部署：${targets.length} 个用户 / ${targets.reduce((sum, t) => sum + t.agents.length, 0)} 个数字人 / ${diffs.length} 条既有差异`,
    );

    for (const target of targets) {
      try {
        const designs = this.readDesignsStrictly(target.agents);
        const artifacts = buildUserArtifacts(designs, context);
        const commit = this.deps.writer.commitUser(target.user_id, artifacts);
        results.push({
          user_id: target.user_id,
          ok: true,
          agents: [
            ...commit.written.map((name) => ({ name, action: 'written' as const, ok: true })),
            ...commit.removed.map((name) => ({ name, action: 'removed' as const, ok: true })),
          ],
        });
        this.deps.manifest.updateUser(target.user_id, target.agents, new Date().toISOString());
      } catch (err) {
        results.push({
          user_id: target.user_id,
          ok: false,
          agents: [],
          error: err instanceof Error ? err.message : String(err),
        });
        this.deps.logger.error(
          { err, event: 'deploy.user.failed', user_id: target.user_id },
          `用户 ${target.user_id} 部署失败（已跳过，其余用户继续）`,
        );
      }
    }

    const errorCount = results.filter((r) => !r.ok).length;
    this.deps.logger.info(
      {
        event: 'deploy.done',
        ok_users: results.filter((r) => r.ok).length,
        failed_users: errorCount,
        written_agents: results.flatMap((r) => r.agents).length,
        duration_ms: Date.now() - startedAt,
      },
      `部署完成：成功 ${results.filter((r) => r.ok).length} / 失败 ${errorCount} 个用户`,
    );
    const historyId = this.deps.history.append({
      result: errorCount === 0 ? 'succeeded' : errorCount === results.length ? 'failed' : 'partial',
      users: results,
      manifest_diff: diffs,
      user_count: results.length,
      error_count: errorCount,
    });

    return { users: results, manifest_diff: diffs, history_id: historyId };
  }

  withdraw(userId: string, revision: number): DeployWithdrawResult {
    this.deps.store.assertRevision(revision);
    const user = this.deps.users.read(userId); // 未知用户 → 404 ADM_USER_NOT_FOUND

    return { user_id: user.user_id, withdrawn: this.revokeArtifacts(user.user_id, 'deploy.withdraw') };
  }

  purgeUser(userId: string): string[] {
    return this.revokeArtifacts(userId, 'deploy.purge');
  }

  private revokeArtifacts(userId: string, event: string): string[] {
    const withdrawn = this.deps.writer.withdrawUser(userId);
    this.deps.manifest.removeUser(userId);
    this.deps.logger.info(
      { event, user_id: userId, agents: withdrawn },
      `已撤回用户 ${userId} 的部署：下架 ${withdrawn.length} 个数字人`,
    );
    return withdrawn;
  }

  private readDesignsStrictly(agentNames: string[]): AgentDesignDocument[] {
    const designs: AgentDesignDocument[] = [];
    for (const name of agentNames) {
      const design = this.deps.agents.readOrNull(name);
      if (!design) {
        throw new Error(
          `数字人 ${name} 的设计态在部署时读取失败（可能已被删除或损坏），本用户未写入任何内容`,
        );
      }
      designs.push(design);
    }
    return designs;
  }

  private resolveTargets(userIds?: string[]): DeployTarget[] {
    if (userIds !== undefined && userIds.length === 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        'user_ids 不能为空数组：部署全部用户请省略该字段，只部署部分用户请传入具体用户标识',
      );
    }

    const all: DeployTarget[] = this.deps.users
      .listAll()
      .map((user) => ({ user_id: user.user_id, agents: [...user.agents] }));
    const targets = userIds === undefined ? all : all.filter((user) => userIds.includes(user.user_id));

    if (userIds) {
      const unknown = userIds.filter((id) => !all.some((user) => user.user_id === id));
      if (unknown.length > 0) {
        // 但"到底是哪几个用户"必须可呈现，否则整批 404 时无从定位（2026-10-20）。
        throw new ApiError(ERROR_CODES.ADM_USER_NOT_FOUND, `用户不存在：${unknown.join('、')}`, {
          user_ids: unknown,
        });
      }
    }

    return targets;
  }
}
