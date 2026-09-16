/**
 * `.opt-agent` 物化写入（`research.md` D8；`FR-008`、`FR-026`、`FR-028`、`FR-029`）。
 *
 * 三条要求合起来只有一种实现能满足：
 * - `FR-008` 原子性（要么完整生效要么完全不生效）
 * - `FR-029` 以**用户为最小单位**且失败不留部分写入
 * - `FR-026` **整体覆盖**（平台侧未搭配的内容 MUST NOT 残留）
 *
 * 实现为：①在目标用户目录的**同挂载点**下建临时目录 → ②把该用户全部数字人的
 * 完整产物写入临时目录 → ③逐个数字人做**目录级原子改名**（旧目录先备份）
 * → ④**清掉 `agents/` 里本次不在列的一切条目** → ⑤失败即回滚到操作前状态
 * → ⑥清理临时与备份。
 *
 * **`agents/` 整体以本次产物为准**（2026-09-16 产品决定，取代原先"按部署清单移除"）：
 * 这样"把某个数字人从用户的关联里去掉再部署"就**一定**能把它从运行环境下架，
 * 不再取决于部署清单是否对得上（清单缺失/被手工改过时，旧目录会永远留下）。
 * 代价是：手工放进 `agents/` 的目录也会被清掉——该目录由平台独占管理。
 *
 * **作用域硬约束**（`FR-028`、`SC-012`）：写入 100% 限于
 * `users/{uid}/agents/`；用户文件空间（`user-data/**`）下的文件与二级目录一律不触碰。
 *
 * **`EXDEV` 降级**（D8）：`rename` 的原子性仅在同一文件系统内成立。
 * 临时目录已建在父目录内，正常情况下不会跨设备；一旦遇到 `EXDEV`，
 * 降级为"逐文件替换 + 失败回滚"，并把该路径纳入测试覆盖。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';

export interface MaterializeFile {
  /** 相对该数字人目录的 posix 路径，如 `TOOL.json`、`skills/pdf-parse/SKILL.md` */
  relPath: string;
  content: string | Buffer;
}

export interface AgentArtifact {
  name: string;
  files: MaterializeFile[];
}

export interface UserCommitResult {
  userId: string;
  written: string[];
  removed: string[];
}

export interface OptAgentWriterOptions {
  optAgentRoot: string;
  logger?: Logger;
  /** 测试可注入 rename（用于覆盖 `EXDEV` 降级路径） */
  renameImpl?: (from: string, to: string) => void;
}

export class OptAgentWriter {
  private readonly root: string;
  private readonly logger: Logger | undefined;
  private readonly rename: (from: string, to: string) => void;

  constructor(options: OptAgentWriterOptions) {
    this.root = options.optAgentRoot;
    this.logger = options.logger;
    this.rename = options.renameImpl ?? fs.renameSync;
  }

  /** `users/{uid}` */
  userDir(userId: string): string {
    return path.join(this.root, 'users', userId);
  }

  /** `users/{uid}/agents/{agent}` */
  agentDir(userId: string, agentName: string): string {
    return path.join(this.userDir(userId), 'agents', agentName);
  }

  /**
   * 以**用户为单位**整体覆盖物化。
   *
   * @param agents 本次需要存在的**全部**数字人产物；`agents/` 下不在其列的一切
   *               条目都会被移除（整体覆盖语义，含手工放进去的目录）
   */
  commitUser(userId: string, agents: AgentArtifact[]): UserCommitResult {
    assertSafeSegment(userId, '用户标识');
    for (const agent of agents) assertSafeSegment(agent.name, '数字人名');

    const userDir = this.userDir(userId);
    const agentsDir = path.join(userDir, 'agents');
    const stamp = `${process.pid}-${Date.now()}`;
    const tmpRoot = path.join(userDir, `.deploy-tmp-${stamp}`);
    const backupRoot = path.join(userDir, `.deploy-old-${stamp}`);

    const created: string[] = [];
    const backups: Array<{ from: string; to: string }> = [];
    const written: string[] = [];
    const removed: string[] = [];

    try {
      fs.mkdirSync(agentsDir, { recursive: true });

      // ①② 在**同挂载点**（用户目录内）构建完整产物
      for (const agent of agents) {
        const target = path.join(tmpRoot, agent.name);
        fs.mkdirSync(target, { recursive: true });
        for (const file of agent.files) {
          const abs = resolveInside(target, file.relPath);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, file.content);
        }
      }

      // ③ 逐个目录级替换（旧目录先备份，便于回滚）
      for (const agent of agents) {
        const from = path.join(tmpRoot, agent.name);
        const to = path.join(agentsDir, agent.name);
        const existed = fs.existsSync(to);
        if (existed) {
          const backup = path.join(backupRoot, agent.name);
          fs.mkdirSync(path.dirname(backup), { recursive: true });
          this.renameSafe(to, backup);
          backups.push({ from: backup, to });
        }
        try {
          this.renameSafe(from, to);
        } catch (err) {
          if (existed) this.renameSafe(path.join(backupRoot, agent.name), to);
          throw err;
        }
        if (!existed) created.push(to);
        written.push(agent.name);
      }

      // ④ 整体覆盖：目标目录里"本次不在列"的一切条目都移除（旧条目先备份，便于回滚）
      const keep = new Set(agents.map((a) => a.name));
      for (const entry of fs.readdirSync(agentsDir)) {
        if (keep.has(entry)) continue;
        const target = path.join(agentsDir, entry);
        const backup = path.join(backupRoot, entry);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        this.renameSafe(target, backup);
        backups.push({ from: backup, to: target });
        removed.push(entry);
      }

      // ⑤ 清理临时与备份
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(backupRoot, { recursive: true, force: true });
      return { userId, written, removed };
    } catch (err) {
      // 回滚：删除新建目录、恢复备份，做到"该用户零写入"
      for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
      for (const { from, to } of backups.reverse()) {
        try {
          if (fs.existsSync(from)) {
            fs.rmSync(to, { recursive: true, force: true });
            this.renameSafe(from, to);
          }
        } catch (rollbackErr) {
          this.logger?.error(
            { err: rollbackErr, event: 'deploy.rollback.failed', user_id: userId },
            `回滚 ${to} 失败，请人工检查`,
          );
        }
      }
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      fs.rmSync(backupRoot, { recursive: true, force: true });

      if (err instanceof ApiError) throw err;
      throw new ApiError(
        ERROR_CODES.ADM_DEPLOY_TARGET_NOT_WRITABLE,
        `写入运行环境失败（已回滚，该用户零写入）：${(err as Error).message}`,
      );
    }
  }

  /**
   * **撤回**：清空该用户在运行环境中的全部数字人目录（2026-09-16）。
   *
   * 与部署同源的纪律：先把 `agents/` 整目录改名到备份名（失败即原样不动），
   * 成功后再删除备份——所以"撤回失败"不会留下半清空的状态。
   * 用户文件空间（`user-data/**`）一律不触碰：撤回的是**能力**，不是数据。
   *
   * @returns 被下架的数字人目录名（取自运行环境实际内容，而非部署清单）
   */
  withdrawUser(userId: string): string[] {
    assertSafeSegment(userId, '用户标识');
    const userDir = this.userDir(userId);
    const agentsDir = path.join(userDir, 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    const names = fs.readdirSync(agentsDir).sort();
    const backup = path.join(userDir, `.withdraw-${process.pid}-${Date.now()}`);
    try {
      this.renameSafe(agentsDir, backup);
    } catch (err) {
      throw new ApiError(
        ERROR_CODES.ADM_DEPLOY_TARGET_NOT_WRITABLE,
        `撤回失败（运行环境未改动）：${(err as Error).message}`,
      );
    }
    try {
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (err) {
      // 目录已经改走（撤回本身已生效），只是备份没删掉：留待人工清理，不影响结果
      this.logger?.warn(
        { err, event: 'deploy.withdraw.cleanup_failed', user_id: userId, path: backup },
        `撤回后的备份目录未能清理：${backup}`,
      );
    }
    return names;
  }

  /**
   * `rename`，遇 `EXDEV`（跨设备）时降级为"复制 + 删除"。
   *
   * 降级本身会失去原子性，故**仅在临时目录与目标不在同一文件系统时**触发；
   * 正常路径（临时目录建在用户目录内）不会走到这里。
   */
  private renameSafe(from: string, to: string): void {
    try {
      this.rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // 只对**跨设备**降级：其他错误（权限、占用）必须原样暴露，
      // 否则会把"写不进去"伪装成"降级成功了"。
      if (code !== 'EXDEV') throw err;
      this.logger?.warn(
        { event: 'deploy.rename.exdev', from, to, code },
        `rename 不可用（${code}），降级为逐文件替换`,
      );
      copyRecursive(from, to);
      fs.rmSync(from, { recursive: true, force: true });
    }
  }
}

/** 解析并确保结果落在 base 之内（双保险：即便上游漏判也不越界） */
function resolveInside(base: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `非法的物化相对路径：${relPath}`);
  }
  const abs = path.resolve(base, ...normalized.split('/').filter(Boolean));
  if (abs !== path.resolve(base) && !abs.startsWith(path.resolve(base) + path.sep)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `物化路径越界：${relPath}`);
  }
  return abs;
}

/** 单段路径名安全（用户标识 / 数字人名） */
function assertSafeSegment(value: string, label: string): void {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    /[/\\]/.test(value) ||
    value.includes('..') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}非法（不可作目录名）：${value}`);
  }
}

/** 递归复制（`EXDEV` 降级路径使用） */
function copyRecursive(from: string, to: string): void {
  const stat = fs.statSync(from);
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) {
      copyRecursive(path.join(from, entry), path.join(to, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
