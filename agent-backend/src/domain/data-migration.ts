import fs from 'node:fs';
import path from 'node:path';
import { listAgents } from './agent-catalog.js';
import { SPACES, THREADS_DIR, ensureAgentDataDirs, userDataDir, userDataRoot } from './dirs.js';

export interface MigrationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

export type OwnerReason = 'current' | 'single' | 'first';

export interface ResolveOwnerOptions {
  currentAgentName?: string | undefined;
  logger?: MigrationLogger | undefined;
  /**
   * 可用清单（缺省现扫 `agents/`）。**顺序即优先级**：调用方给出的清单必须已按名称升序
   * （既有 `listAgents` 的口径），判定③直接取首项，MUST NOT 在此另写一套排序。
   */
  availableAgents?: readonly string[] | undefined;
}

export interface OwnerDecision {
  agentName: string;
  reason: OwnerReason;
  candidates: string[];
}

const LEGACY_LAYOUT_ENTRIES: ReadonlySet<string> = new Set<string>([...SPACES, THREADS_DIR]);

export type MigrationStatus = 'no-source' | 'blocked' | 'migrated';

export interface MigrationResult {
  userId: string;
  status: MigrationStatus;
  ownerAgent: string | null;
  ownerReason: OwnerReason | null;
  movedCount: number;
  skipped: string[];
  failed: string[];
}

/** 运行期根下已知用户（`users/*` 目录名）；缺失返回空数组 */
export function listUserIds(optAgentRoot: string): string[] {
  try {
    return fs
      .readdirSync(path.join(optAgentRoot, 'users'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

function availableAgentsOf(
  optAgentRoot: string,
  userId: string,
  opts: ResolveOwnerOptions,
): string[] {
  if (opts.availableAgents) return [...opts.availableAgents];
  const logger = opts.logger;
  return listAgents(
    optAgentRoot,
    userId,
    logger
      ? {
          warn: (msg: string) =>
            logger.warn({ event: 'data.migration.agent_skipped', uid: userId }, msg),
        }
      : undefined,
  ).map((a) => a.agent_name);
}

/**
 * 归属判定（FR-040）：返回 `undefined` 表示"清单为空 → 不迁移"。
 *
 * ③ 取清单首项即"名称升序第一"——排序口径的唯一来源是 `listAgents`
 * （`agent_name.localeCompare`），本函数 MUST NOT 重新排序（跨平台可复现性见 plan §平台差异风险）。
 */
export function resolveOwnerAgent(
  optAgentRoot: string,
  userId: string,
  opts: ResolveOwnerOptions = {},
): OwnerDecision | undefined {
  const candidates = availableAgentsOf(optAgentRoot, userId, opts);
  const first = candidates[0];
  if (first === undefined) return undefined;
  if (opts.currentAgentName && candidates.includes(opts.currentAgentName)) {
    return { agentName: opts.currentAgentName, reason: 'current', candidates };
  }
  if (candidates.length === 1) return { agentName: first, reason: 'single', candidates };
  return { agentName: first, reason: 'first', candidates };
}

export function migrateUserDataLayout(
  optAgentRoot: string,
  userId: string,
  opts: ResolveOwnerOptions = {},
): MigrationResult {
  const result: MigrationResult = {
    userId,
    status: 'no-source',
    ownerAgent: null,
    ownerReason: null,
    movedCount: 0,
    skipped: [],
    failed: [],
  };

  const src = userDataRoot(optAgentRoot, userId);
  let entries: string[];
  try {
    entries = fs.readdirSync(src).sort();
  } catch {
    return result; // 源不存在：无需迁移（幂等）
  }
  if (entries.length === 0) {
    removeEmptyDir(src);
    return result;
  }

  const candidates = availableAgentsOf(optAgentRoot, userId, opts);
  // 既不是旧布局残留，也 MUST NOT 被搬进别的数字人数据域：一律原地不动。
  // 不落任何审计噪音（否则每次启动 / 每次切换数字人都会写一遍 start/owner/done）。
  const movable = entries.filter(
    (name) => LEGACY_LAYOUT_ENTRIES.has(name) && !candidates.includes(name),
  );
  if (movable.length === 0) return result;

  opts.logger?.info(
    { event: 'data.migration.start', uid: userId, entries: movable.length },
    `开始迁移用户级数据布局（uid=${userId}，一级条目 ${movable.length} 个）`,
  );

  const decision = resolveOwnerAgent(optAgentRoot, userId, {
    ...opts,
    availableAgents: candidates,
  });
  if (!decision) {
    // 兜底分支（FR-040）：原地保留、不对用户可见，待其获得数字人后于下次触发迁移
    result.status = 'blocked';
    opts.logger?.warn(
      {
        event: 'data.migration.blocked',
        uid: userId,
        reason: 'no_available_agent',
        entries: entries.length,
      },
      `用户 ${userId} 无可用数字人：存量数据原地保留，待其获得数字人后重试迁移`,
    );
    return result;
  }

  result.ownerAgent = decision.agentName;
  result.ownerReason = decision.reason;
  opts.logger?.info(
    {
      event: 'data.migration.owner',
      uid: userId,
      owner_agent: decision.agentName,
      reason: decision.reason,
      candidates: decision.candidates,
    },
    `迁移归属判定：${decision.agentName}（依据 ${decision.reason}）`,
  );

  // 于是每一项都被判冲突跳过，数据反而留在旧位（骨架在搬迁后补齐，幂等）
  const dst = userDataDir(optAgentRoot, userId, decision.agentName);
  fs.mkdirSync(dst, { recursive: true });
  const available = decision.candidates;

  for (const name of entries) {
    if (!LEGACY_LAYOUT_ENTRIES.has(name)) continue;
    if (available.includes(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.existsSync(to)) {
      // 要么是上次中断留下的空壳；不搬进去的话，旧位数据会永远残留在用户级（半成品不可恢复）。
      if (!removeEmptyDir(to)) {
        result.skipped.push(name);
        opts.logger?.warn(
          {
            event: 'data.migration.skipped',
            uid: userId,
            owner_agent: decision.agentName,
            entry: name,
            reason: 'target_exists',
          },
          `迁移跳过：目标已存在同名项（owner=${decision.agentName}，entry=${name}），不合并、不覆盖`,
        );
        continue;
      }
      opts.logger?.info(
        {
          event: 'data.migration.rescued_empty_target',
          uid: userId,
          owner_agent: decision.agentName,
          entry: name,
        },
        `目标同名项为空目录，直接搬入（owner=${decision.agentName}，entry=${name}）`,
      );
    }
    try {
      fs.renameSync(from, to); // 同卷内单条改名＝原子；可中断续跑（plan §迁移口径）
      result.movedCount++;
      opts.logger?.info(
        {
          event: 'data.migration.moved',
          uid: userId,
          owner_agent: decision.agentName,
          entry: name,
        },
        `迁移完成一项：${name} → user-data/${decision.agentName}/${name}`,
      );
    } catch (err) {
      // 跨卷等失败：明确报错并**保持原状**（MUST NOT 静默降级为复制，plan §平台差异风险）
      result.failed.push(name);
      opts.logger?.error(
        {
          alert: true,
          err,
          event: 'data.migration.error',
          uid: userId,
          owner_agent: decision.agentName,
          entry: name,
          reason: (err as NodeJS.ErrnoException | undefined)?.code ?? 'unknown',
        },
        `迁移失败，该项保持原状（uid=${userId} entry=${name}）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  result.status = 'migrated';
  // 补齐源里缺的空间/会话目录（幂等；已搬进来的内容不动）
  ensureAgentDataDirs(optAgentRoot, userId, decision.agentName);
  removeEmptyDir(src);
  opts.logger?.info(
    {
      event: 'data.migration.done',
      uid: userId,
      owner_agent: decision.agentName,
      moved_count: result.movedCount,
      skipped: result.skipped,
      failed: result.failed,
    },
    `数据布局迁移结束（uid=${userId} owner=${decision.agentName} 搬迁 ${result.movedCount} 项）`,
  );
  return result;
}

/** 迁移运行期根下的全部已知用户（启动期触发；逐用户独立失败，不互相影响） */
export function migrateAllUsers(
  optAgentRoot: string,
  opts: {
    logger?: MigrationLogger | undefined;
    currentAgentOf?: ((userId: string) => string | undefined) | undefined;
  } = {},
): MigrationResult[] {
  const results: MigrationResult[] = [];
  for (const userId of listUserIds(optAgentRoot)) {
    const currentAgentName = opts.currentAgentOf?.(userId);
    results.push(
      migrateUserDataLayout(optAgentRoot, userId, {
        ...(currentAgentName === undefined ? {} : { currentAgentName }),
        ...(opts.logger === undefined ? {} : { logger: opts.logger }),
      }),
    );
  }
  return results;
}

/**
 * 尝试删掉一个**空**目录，返回是否真的删掉了。
 *
 * 先 `readdirSync` 判空再 `rmdirSync`（而不是捕获 `ENOTEMPTY`）：让两条语义一眼可读——
 * 空 ⇒ 可以"让位"给迁移；非空 ⇒ 是硬冲突（不合并、不覆盖）。
 * 不存在 / 无权限 / 竞态一律按"没删成"处理（清理空壳失败不影响迁移结果）。
 */
function removeEmptyDir(dir: string): boolean {
  try {
    if (fs.readdirSync(dir).length > 0) return false;
    fs.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
