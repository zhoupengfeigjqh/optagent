/**
 * 账号域目录结构收敛的**规划与执行**（2026-11-27）。
 *
 * 旧结构：`.platform-data/users/{uid}.json`、`.platform-data/sessions/{uid}.json`
 * 新结构：`.platform-data/accounts/users/{uid}.json`、`.../accounts/sessions/{uid}.json`
 *
 * 语义：**复制而非移动**——旧目录原样保留，删不删由人决定（迁移脚本只报告）。
 * 幂等：新文件已存在且字节一致 = `identical`；不一致 = `conflict`，**不覆盖**。
 *
 * 之所以拆成"规划 + 执行"两步：规划是纯读取，可被单测覆盖；执行只写 `copied` 项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { LEGACY_SESSIONS_DIR, LEGACY_USERS_DIR, SESSIONS_DIR, USERS_DIR } from '../domain/account/paths.js';

/** 单个文件（`{id}.json`）的迁移判定 */
export type MigrationStatus = 'copied' | 'identical' | 'conflict';

export interface MigrationItem {
  /** 文件名去扩展名（用户 = user_id，会话 = user_id） */
  id: string;
  status: MigrationStatus;
  /** `conflict` 时说明原因 */
  reason?: string;
}

export interface MigrationGroup {
  key: 'users' | 'sessions';
  /** 旧目录绝对路径 */
  from: string;
  /** 新目录绝对路径 */
  to: string;
  items: MigrationItem[];
}

export interface MigrationPlan {
  dataRoot: string;
  groups: MigrationGroup[];
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));
}

function readTextOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function planGroup(
  key: MigrationGroup['key'],
  dataRoot: string,
  relFrom: string,
  relTo: string,
): MigrationGroup {
  const from = path.join(dataRoot, ...relFrom.split('/'));
  const to = path.join(dataRoot, ...relTo.split('/'));
  const items: MigrationItem[] = [];

  for (const file of listJsonFiles(from)) {
    const id = file.slice(0, -'.json'.length);
    const source = readTextOrNull(path.join(from, file));
    if (source === null) continue;
    const target = readTextOrNull(path.join(to, file));
    if (target === null) {
      items.push({ id, status: 'copied' });
    } else if (target === source) {
      items.push({ id, status: 'identical' });
    } else {
      items.push({
        id,
        status: 'conflict',
        reason: '目标已存在且内容不同，拒绝覆盖（请人工比对后决定保留哪份）',
      });
    }
  }
  return { key, from, to, items };
}

/** 只读规划：不修改任何文件 */
export function planAccountsLayoutMigration(dataRoot: string): MigrationPlan {
  return {
    dataRoot,
    groups: [
      planGroup('users', dataRoot, LEGACY_USERS_DIR, USERS_DIR),
      planGroup('sessions', dataRoot, LEGACY_SESSIONS_DIR, SESSIONS_DIR),
    ],
  };
}

export interface ApplyResult {
  copied: number;
  identical: number;
  conflicts: number;
}

/** 执行：只写 `copied` 项（`mkdir -p` + 整文件写入），返回统计 */
export function applyAccountsLayoutMigration(plan: MigrationPlan): ApplyResult {
  const result: ApplyResult = { copied: 0, identical: 0, conflicts: 0 };
  for (const group of plan.groups) {
    for (const item of group.items) {
      if (item.status === 'identical') {
        result.identical += 1;
        continue;
      }
      if (item.status === 'conflict') {
        result.conflicts += 1;
        continue;
      }
      const source = readTextOrNull(path.join(group.from, `${item.id}.json`));
      if (source === null) continue;
      fs.mkdirSync(group.to, { recursive: true });
      fs.writeFileSync(path.join(group.to, `${item.id}.json`), source, 'utf8');
      result.copied += 1;
    }
  }
  return result;
}
