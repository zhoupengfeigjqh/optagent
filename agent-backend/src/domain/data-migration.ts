/**
 * 存量数据一次性迁移（009 US4 / FR-040~042）：把"用户级共享"的数据搬到**归属数字人**目录下。
 *
 * ```text
 * 改前：users/{uid}/user-data/{数据准备|共享空间|临时空间|threads}
 * 改后：users/{uid}/user-data/{归属数字人}/{同上}
 * ```
 *
 * 三条口径（`specs/009-agent-data-isolation/data-model.md` §4.3 / §5）：
 *
 * 1. **归属判定是确定性的**（`resolveOwnerAgent`）：①该用户当前选中的数字人（须在可用清单内）
 *    →②可用清单中唯一的数字人→③清单有多个且无选中态时取**名称升序第一**（③ 是"可追溯的
 *    确定性默认"，MUST 落审计）；可用清单为空 ⇒ **不迁移**、原地保留 + 告警，等下次触发。
 * 2. **迁移＝逐项原子改名**（`fs.renameSync`）：逐个子项搬；目标同名项存在时分两种：
 *    **空目录**（骨架先被建出来 / 上次中断留下的空壳）⇒ 搬进去（不删任何内容，救回"半成品"），
 *    **非空**⇒ **跳过 + 告警**（不合并、不覆盖）。因此可中断续跑、不占双倍空间；
 *    幂等判据＝**源目录不存在**。搬迁对象**只有旧布局的四个固定一级名**（见
 *    `LEGACY_LAYOUT_ENTRIES`）——其余一等条目一律原地不动。
 * 3. **失败保持原状**：跨卷（`EXDEV`）等改名失败 MUST NOT 静默降级为复制，MUST 明确落
 *    `error` 日志（含 `alert: true`）并跳过该项——其余项照常迁移，下次触发继续尝试。
 *
 * 刻意**不做**的事：不读/写平台侧数据；不碰 `agents/`（配置目录，归平台部署语义管）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { listAgents } from './agent-catalog.js';
import { SPACES, THREADS_DIR, ensureAgentDataDirs, userDataDir, userDataRoot } from './dirs.js';

/** 迁移日志（结构同 pino：`logger.info(obj, msg)`） */
export interface MigrationLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** 归属判定来源（①当前选中 / ②唯一 / ③名称升序第一） */
export type OwnerReason = 'current' | 'single' | 'first';

export interface ResolveOwnerOptions {
  /** 归属判定①的候选：该用户当前选中的数字人（不在可用清单内则忽略） */
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
  /** 参与判定的可用清单（③ 的歧义决定要能复核） */
  candidates: string[];
}

/**
 * 009 改造前**用户级**布局的全部一级条目名：三空间 + `threads`。
 *
 * 迁移只认这四个名字（2026-10-23 修复）。原判据是"不在当前 `agents/` 清单里即为旧布局残留"，
 * 而**撤销部署只清 `agents/`、`user-data/**` 按 `FR-028` 保留**——于是被撤销数字人的数据域目录
 * （`user-data/{已撤销数字人}/`）被误判成旧布局残留，整体改名搬进"当前选中的数字人"数据域：
 * 表现为"别人的会话与文件出现在我的数字人文件夹里"，且每次切换数字人都再搬一次。
 *
 * 归属数字人的数据域是**数字人级**的（`userDataDir`），其存在性与"当前是否部署"无关，
 * 故 MUST NOT 用可用清单反推"哪些目录属于数字人"。
 */
const LEGACY_LAYOUT_ENTRIES: ReadonlySet<string> = new Set<string>([...SPACES, THREADS_DIR]);

export type MigrationStatus = 'no-source' | 'blocked' | 'migrated';

export interface MigrationResult {
  userId: string;
  status: MigrationStatus;
  /** 归属数字人；`null` = 无可归属（清单为空，原地保留） */
  ownerAgent: string | null;
  ownerReason: OwnerReason | null;
  /** 成功搬迁的一级条目数 */
  movedCount: number;
  /** 目标已存在同名项而跳过的一级条目名 */
  skipped: string[];
  /** 改名失败（如 EXDEV）而保持原状的一级条目名 */
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

/**
 * 可用数字人清单（数字人级身份＝名称；缺省扫 `agents/`，已按名称升序）。
 *
 * 排序口径的唯一来源是 `listAgents`（`agent_name.localeCompare`）——判定③依赖它，
 * 故此处只透传、不重排；告警经适配器转成结构化事件（`listAgents` 只收 `warn(msg)`）。
 */
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

/**
 * 迁移一个用户的数据布局（幂等、可重复执行）。
 *
 * - 源目录不存在 ⇒ 直接返回（`no-source`）：这是"已完成"的等价判据，也是幂等的落点
 * - 源目录存在但为空 ⇒ 清掉空壳后返回 `no-source`
 * - 目标位置是该用户的**归属数字人**数据域（只先建数据域根；三空间骨架在搬迁**之后**补齐——
 *   先建骨架会让每个同名目标都"已存在"，把可迁的项全变成跳过）
 * - 已经是数字人数据目录的一级条目（名字在可用清单内，含归属数字人自己）**原样不动**：
 *   它们本就是新布局，搬进另一个数字人目录＝毁数据
 */
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
    removeEmptyDir(src); // 空壳（如上一次迁移后留下的）：清掉即可
    return result;
  }

  // 可用清单在此**先算一次**：既用于归属判定，也用于"还剩没得搬的"判据
  const candidates = availableAgentsOf(optAgentRoot, userId, opts);
  // 只认旧布局的四个固定名（2026-10-23）。`user-data/` 下的**其它**一级条目——
  // 尤其是已撤销数字人的数据域目录（撤销只清 `agents/`，数据按 FR-028 保留）——
  // 既不是旧布局残留，也 MUST NOT 被搬进别的数字人数据域：一律原地不动。
  //
  // 也正因如此，`movable` 为空（只剩数字人数据目录）时直接判"无需迁移"，
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

  // 只先建**数据域根**：三空间骨架 MUST 晚于搬迁——先建骨架会让同名目标"已存在"，
  // 于是每一项都被判冲突跳过，数据反而留在旧位（骨架在搬迁后补齐，幂等）
  const dst = userDataDir(optAgentRoot, userId, decision.agentName);
  fs.mkdirSync(dst, { recursive: true });
  const available = decision.candidates;

  for (const name of entries) {
    // 非旧布局条目（已撤销数字人的数据域等）：原地不动，连"目标已存在"的判定都不参与
    if (!LEGACY_LAYOUT_ENTRIES.has(name)) continue;
    // 已是某个数字人的数据目录（新布局）：不动
    if (available.includes(name)) continue;
    const from = path.join(src, name);
    const to = path.join(dst, name);
    if (fs.existsSync(to)) {
      // 目标同名项已存在：**空目录**先"让位"——它要么是骨架（`ensureAgentDataDirs`）先建出来的，
      // 要么是上次中断留下的空壳；不搬进去的话，旧位数据会永远残留在用户级（半成品不可恢复）。
      // 非空目标仍是硬冲突：不合并、不覆盖，留痕待人工处理。
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
  // 源目录全空 → 清掉用户级落点（FR-002）；非空（有跳过/失败项）则保留，等下次重试
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
    /** 逐用户取"当前选中数字人"（判定①）；缺省无选中态（启动期即如此） */
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
