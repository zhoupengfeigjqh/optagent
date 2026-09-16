/**
 * 部署编排（`FR-026`~`FR-034`，`contracts/admin-api.md` §6.5~§6.8）。
 *
 * 流程固定为：**只读预校验 → 全部通过才写入**（`FR-027`）。
 * 校验不通过时**运行环境写入次数为 0**（`SC-020`），并**一次性列出全部错误项**。
 *
 * 错误码选择规则（使三类具体原因都能被直接看到，而不是一律压在通用码下）：
 * - 全部错误项**同码** → 直接返回该码（如 `ADM_RUNTIME_FORM_NOT_CONFIGURED`、
 *   `ADM_DEPLOY_TARGET_NOT_WRITABLE`），便于界面与合作方按码处理；
 * - 混合原因 → 返回 `ADM_DEPLOY_VALIDATION_FAILED`，`details.errors` 含全部错误项。
 * 两种情况下 `details.errors` 都完整——"一次性列出全部"不被这条规则削弱。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import type { AgentDesignDocument, AgentDesignService } from '../config-center/agent-design.js';
import type { UnifiedCatalog } from '../config-center/unified-catalog.js';
import type { UserLinkService } from '../config-center/user-links.js';
import type { McpServiceConfigService } from '../mcp/service-config.js';
import type { PlatformSettingsService } from '../platform-settings.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import type { DeployHistoryService, DeployUserRecord } from './history.js';
import type { DeployManifestService, ManifestDiffEntry } from './manifest.js';
import { buildUserArtifacts, type MaterializeContext } from './materialize.js';
import { runPrecheck, type PrecheckError, type PrecheckUser } from './precheck.js';
import type { OptAgentWriter } from '../../infra/opt-agent-writer.js';
import type { PlatformStore } from '../../infra/platform-store.js';

export interface DeployerDeps {
  optAgentRoot: string;
  store: PlatformStore;
  agents: AgentDesignService;
  users: UserLinkService;
  mcpConfigs: McpServiceConfigService;
  skills: SkillLibraryService;
  catalog: UnifiedCatalog;
  settings: PlatformSettingsService;
  writer: OptAgentWriter;
  manifest: DeployManifestService;
  history: DeployHistoryService;
  logger: Logger;
}

export interface DeployValidationResult {
  passed: boolean;
  errors: PrecheckError[];
}

export interface DeployRunResult {
  target_runtime_form: string;
  users: DeployUserRecord[];
  manifest_diff: ManifestDiffEntry[];
  history_id: string;
}

/** 撤回部署的结果（`§6.9`） */
export interface DeployWithdrawResult {
  user_id: string;
  /** 被下架的数字人目录名（取自运行环境实际内容，而非部署清单） */
  withdrawn: string[];
}

export class Deployer {
  constructor(private readonly deps: DeployerDeps) {}

  /** 部署清单（`GET /api/admin/deploy/manifest`，§6.8） */
  get manifest(): DeployManifestService {
    return this.deps.manifest;
  }

  /** 部署历史（`GET /api/admin/deploy/history`，§6.7） */
  get history(): DeployHistoryService {
    return this.deps.history;
  }

  /** 只读预检（§6.5）；与 `deploy` 的校验**同一实现**，MUST NOT 形成两套判定 */
  async validate(userIds?: string[]): Promise<DeployValidationResult> {
    const { errors } = await this.collect(userIds);
    return { passed: errors.length === 0, errors };
  }

  /** 部署生效（§6.6） */
  async deploy(userIds: string[] | undefined, revision: number): Promise<DeployRunResult> {
    // 乐观锁先于一切：版本不符即拒，避免基于陈旧配置部署
    this.deps.store.assertRevision(revision);

    const { errors, targets, snapshot } = await this.collect(userIds);
    if (errors.length > 0) throw validationError(errors);

    const form = this.deps.settings.targetForm();
    const context: MaterializeContext = {
      form,
      mcpConfigs: this.deps.mcpConfigs,
      skills: this.deps.skills,
    };

    const results: DeployUserRecord[] = [];
    const diffs: ManifestDiffEntry[] = [];
    const startedAt = Date.now();

    // 关键行为日志（任务 2026-09-15）：部署是平台最重的写操作，起止必须留痕
    this.deps.logger.info(
      {
        event: 'deploy.begin',
        target_runtime_form: form,
        users: targets.map((t) => t.user_id),
        agent_count: targets.reduce((sum, t) => sum + t.agents.length, 0),
      },
      `开始部署：${targets.length} 个用户 / ${targets.reduce((sum, t) => sum + t.agents.length, 0)} 个数字人`,
    );

    for (const target of targets) {
      const designs = target.agents
        .map((name) => this.deps.agents.readOrNull(name))
        .filter((doc): doc is AgentDesignDocument => doc !== null);

      try {
        const artifacts = buildUserArtifacts(designs, context);
        // 整体覆盖：`agents/` 下不在本次产物里的一切条目都会被清掉（2026-09-16）
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
        // FR-029：单用户失败即该用户零写入，其余用户不受影响
        results.push({
          user_id: target.user_id,
          ok: false,
          agents: [],
          error: err instanceof Error ? err.message : String(err),
        });
        diffs.push({
          user_id: target.user_id,
          target: '',
          kind: 'missing_in_runtime',
          detail: `部署失败：${err instanceof Error ? err.message : String(err)}`,
        });
        this.deps.logger.error(
          { err, event: 'deploy.user.failed', user_id: target.user_id },
          `用户 ${target.user_id} 部署失败`,
        );
      }
    }

    const errorCount = results.filter((r) => !r.ok).length;
    this.deps.logger.info(
      {
        event: 'deploy.done',
        target_runtime_form: form,
        ok_users: results.filter((r) => r.ok).length,
        failed_users: errorCount,
        written_agents: results.flatMap((r) => r.agents).length,
        // 时长：回答"部署是不是变慢了"（任务 2026-09-16）
        duration_ms: Date.now() - startedAt,
      },
      `部署完成：成功 ${results.filter((r) => r.ok).length} / 失败 ${errorCount} 个用户`,
    );
    const historyId = this.deps.history.append({
      target_runtime_form: form,
      result: errorCount === 0 ? 'succeeded' : errorCount === results.length ? 'failed' : 'partial',
      users: results,
      validation: { passed: true, error_count: 0 },
      manifest_diff: diffs,
      user_count: results.length,
      error_count: errorCount,
    });
    void snapshot;

    return { target_runtime_form: form, users: results, manifest_diff: diffs, history_id: historyId };
  }

  /**
   * **撤回部署**（`§6.9`，用户卡片上的「撤回」）。
   *
   * 清空该用户在运行环境中的**全部数字人目录**——这些数字人随即失去能力；
   * 平台侧的关联与用户文件空间**一律保留**（需要时重新部署即可恢复）。
   * 清单里该用户的条目同时移除，卡片随之显示"未部署"。
   *
   * 纪律与 `deploy` 一致：乐观锁先行、只动 `users/{uid}/agents/`。
   */
  withdraw(userId: string, revision: number): DeployWithdrawResult {
    this.deps.store.assertRevision(revision);
    const user = this.deps.users.read(userId); // 未知用户 → 404 ADM_USER_NOT_FOUND

    const withdrawn = this.deps.writer.withdrawUser(user.user_id);
    this.deps.manifest.removeUser(user.user_id);
    this.deps.logger.info(
      { event: 'deploy.withdraw', user_id: user.user_id, agents: withdrawn },
      `已撤回用户 ${user.user_id} 的部署：下架 ${withdrawn.length} 个数字人`,
    );

    return { user_id: user.user_id, withdrawn };
  }

  /** 组装预检输入（校验与实际部署共用，保证判定一致） */
  private async collect(userIds?: string[]): Promise<{
    errors: PrecheckError[];
    targets: PrecheckUser[];
    snapshot: Awaited<ReturnType<UnifiedCatalog['snapshot']>>;
  }> {
    const snapshot = await this.deps.catalog.snapshot();
    const form = this.deps.settings.targetForm();

    const all: PrecheckUser[] = this.deps.users
      .listAll()
      .map((user) => ({ user_id: user.user_id, agents: [...user.agents] }));
    const targets =
      userIds === undefined || userIds.length === 0
        ? all
        : all.filter((user) => userIds.includes(user.user_id));

    if (userIds && userIds.length > 0) {
      const unknown = userIds.filter((id) => !all.some((user) => user.user_id === id));
      if (unknown.length > 0) {
        throw new ApiError(ERROR_CODES.ADM_USER_NOT_FOUND, `用户不存在：${unknown.join('、')}`);
      }
    }

    const errors = runPrecheck({
      users: targets,
      readDesign: (name) => this.deps.agents.readOrNull(name),
      index: snapshot.index,
      toolsUnavailableReason: snapshot.toolsUnavailableReason,
      runtimeForm: form,
      endpointFor: (serviceName) => this.deps.mcpConfigs.endpointFor(serviceName, form),
      isWritable: (userId) => this.isUserTargetWritable(userId),
    });
    return { errors, targets, snapshot };
  }

  /** 目标可写：`users/{uid}/agents`（不存在时向上找最近的可写祖先） */
  private isUserTargetWritable(userId: string): boolean {
    let current = path.join(this.deps.optAgentRoot, 'users', userId, 'agents');
    for (let depth = 0; depth < 32; depth += 1) {
      if (fs.existsSync(current)) {
        try {
          fs.accessSync(current, fs.constants.W_OK);
          return true;
        } catch {
          return false;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) return false;
      current = parent;
    }
    return false;
  }
}

/** 见文件头注释：同码直接返回该码，混合原因用通用码；两种情况下 details.errors 都完整 */
export function validationError(errors: PrecheckError[]): ApiError {
  const codes = [...new Set(errors.map((e) => e.code))];
  const code = codes.length === 1 ? codes[0]! : ERROR_CODES.ADM_DEPLOY_VALIDATION_FAILED;
  return new ApiError(code, `部署前校验未通过（共 ${errors.length} 项），已阻止部署`, {
    errors,
    codes,
  });
}
