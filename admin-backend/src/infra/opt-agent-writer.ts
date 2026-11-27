import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { ApiError } from '../domain/api-error.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { removeTree } from './fs-remove.js';

export interface MaterializeFile {
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

  userDir(userId: string): string {
    return path.join(this.root, 'users', userId);
  }

  agentDir(userId: string, agentName: string): string {
    return path.join(this.userDir(userId), 'agents', agentName);
  }

  /**
   * 运行环境中该用户**已落地的数字人目录名**（2026-10-20，差异报告 `FR-032` 的取数口）。
   *
   * 目录不存在 → 空数组（从未部署过）。只看目录，不看文件，避免把残留文件误当成数字人。
   */
  listAgents(userId: string): string[] {
    assertSafeSegment(userId, '用户标识');
    const agentsDir = path.join(this.userDir(userId), 'agents');
    if (!fs.existsSync(agentsDir)) return [];
    try {
      return fs
        .readdirSync(agentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    } catch {
      // `agents` 被占成一个文件 / 目录不可读：差异报告只是辅助信息，MUST NOT 阻断部署。
      return [];
    }
  }

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
      removeTree(tmpRoot);
      removeTree(backupRoot);
      return { userId, written, removed };
    } catch (err) {
      // 回滚：删除新建目录、恢复备份，做到"该用户零写入"
      for (const dir of created) removeTree(dir);
      for (const { from, to } of backups.reverse()) {
        try {
          if (fs.existsSync(from)) {
            removeTree(to);
            this.renameSafe(from, to);
          }
        } catch (rollbackErr) {
          this.logger?.error(
            { err: rollbackErr, event: 'deploy.rollback.failed', user_id: userId },
            `回滚 ${to} 失败，请人工检查`,
          );
        }
      }
      removeTree(tmpRoot);
      removeTree(backupRoot);

      if (err instanceof ApiError) throw err;
      throw new ApiError(
        ERROR_CODES.ADM_DEPLOY_TARGET_NOT_WRITABLE,
        `写入运行环境失败（已回滚，该用户零写入）：${(err as Error).message}`,
      );
    }
  }

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
      removeTree(backup);
    } catch (err) {
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
      removeTree(from);
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
