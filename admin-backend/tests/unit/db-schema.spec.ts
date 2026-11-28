/**
 * DDL 防回归（不连库）：`schema.sql` 与代码口径必须一致。
 *
 * 守住三类已发生的漂移：`users.status` 残留（文件模式无此字段）、
 * 两条会挡住删除/迁移的外键、以及"只有库版本才有的列名"。
 */
import { describe, expect, it } from 'vitest';
import { readSchemaStatements } from '../../scripts/lib/schema-sql.js';

const statements = readSchemaStatements();
const tableOf = (name: string): string =>
  statements.find((statement) => new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\b`, 'i').test(statement)) ?? '';

describe('schema.sql', () => {
  it('剥离建库/切库后只剩表级 DDL 与种子语句', () => {
    expect(statements.every((statement) => !/^\s*(create\s+database|use)\b/i.test(statement))).toBe(true);
    expect(statements).toHaveLength(5);
  });

  it('包含账号域四表', () => {
    for (const table of ['agent_services', 'users', 'register_links', 'sessions']) {
      expect(tableOf(table), `缺少表 ${table}`).not.toBe('');
    }
  });

  it('users 不含 status 列（状态不入库）', () => {
    expect(tableOf('users')).not.toMatch(/\bstatus\b/i);
  });

  it('不保留 fk_users_source / fk_register_links_agent，保留 fk_sessions_user', () => {
    const all = statements.join('\n');
    expect(all).not.toMatch(/fk_users_source/i);
    expect(all).not.toMatch(/fk_register_links_agent/i);
    expect(tableOf('sessions')).toMatch(/fk_sessions_user/i);
  });

  it('被去掉的外键留下索引（查询性能不退化）', () => {
    expect(tableOf('users')).toMatch(/idx_users_source/);
    expect(tableOf('register_links')).toMatch(/idx_register_links_agent/);
  });

  it('账号密码列名与文件模式字段同名（password）', () => {
    expect(tableOf('users')).toMatch(/`password`\s+JSON/);
    expect(tableOf('users')).not.toMatch(/password_record/i);
  });
});
