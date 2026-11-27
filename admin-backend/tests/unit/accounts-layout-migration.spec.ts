/**
 * 单元测试：账号域目录结构收敛（`.platform-data/{users,sessions}` → `accounts/{users,sessions}`）
 *
 * 覆盖四个判定分支：copied / identical / conflict / 空旧目录，
 * 以及执行后的幂等与内容保真（不覆盖、不改写）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyAccountsLayoutMigration,
  planAccountsLayoutMigration,
} from '../../src/infra/accounts-layout-migration.js';

let root: string;

function writeJsonAt(rel: string, doc: unknown): void {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function readAt(rel: string): string {
  return fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'accounts-layout-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('planAccountsLayoutMigration', () => {
  it('旧目录不存在 → 两组都为空（已是新结构）', () => {
    const plan = planAccountsLayoutMigration(root);
    expect(plan.groups.map((g) => g.items)).toEqual([[], []]);
  });

  it('旧有新无 → copied', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: [] });
    writeJsonAt('sessions/admin.json', { user_id: 'admin', session_id: 's1' });

    const plan = planAccountsLayoutMigration(root);
    expect(plan.groups[0]!.items).toEqual([{ id: 'admin', status: 'copied' }]);
    expect(plan.groups[1]!.items).toEqual([{ id: 'admin', status: 'copied' }]);
  });

  it('新旧内容一致 → identical', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: [] });
    writeJsonAt('accounts/users/admin.json', { user_id: 'admin', agents: [] });

    const plan = planAccountsLayoutMigration(root);
    expect(plan.groups[0]!.items[0]).toEqual({ id: 'admin', status: 'identical' });
  });

  it('新旧内容不一致 → conflict（拒绝覆盖）', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: ['a'] });
    writeJsonAt('accounts/users/admin.json', { user_id: 'admin', agents: ['b'] });

    const plan = planAccountsLayoutMigration(root);
    const item = plan.groups[0]!.items[0]!;
    expect(item.status).toBe('conflict');
    expect(item.reason).toContain('拒绝覆盖');
  });

  it('只统计 .json，忽略其它文件', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: [] });
    fs.writeFileSync(path.join(root, 'users', 'notes.txt'), 'x', 'utf8');

    const plan = planAccountsLayoutMigration(root);
    expect(plan.groups[0]!.items.map((i) => i.id)).toEqual(['admin']);
  });
});

describe('applyAccountsLayoutMigration', () => {
  it('只写 copied 项，内容逐字节保真；重跑即全部 identical（幂等）', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: ['生产调度测试'] });
    writeJsonAt('users/ops.json', { user_id: 'ops', agents: [] });

    const first = applyAccountsLayoutMigration(planAccountsLayoutMigration(root));
    expect(first).toEqual({ copied: 2, identical: 0, conflicts: 0 });
    expect(readAt('accounts/users/admin.json')).toBe(readAt('users/admin.json'));

    const second = applyAccountsLayoutMigration(planAccountsLayoutMigration(root));
    expect(second).toEqual({ copied: 0, identical: 2, conflicts: 0 });
  });

  it('冲突项不写目标文件，源与目标都保持原样', () => {
    writeJsonAt('users/admin.json', { user_id: 'admin', agents: ['a'] });
    writeJsonAt('accounts/users/admin.json', { user_id: 'admin', agents: ['b'] });
    const before = readAt('accounts/users/admin.json');

    const result = applyAccountsLayoutMigration(planAccountsLayoutMigration(root));
    expect(result).toEqual({ copied: 0, identical: 0, conflicts: 1 });
    expect(readAt('accounts/users/admin.json')).toBe(before);
    expect(readAt('users/admin.json')).toContain('"a"');
  });
});
