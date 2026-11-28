/**
 * 搬运映射的**唯一实现点**（`scripts/migrate-to-mysql.ts` 与用例共用）。
 *
 * 列口径来自 `specs/029-account-mysql-alignment/data-model.md` §必迁列清单：
 * 文件键 → 表列同名同义，表独有列（`id`、账号的时间列）不在此处出现。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { UserLinkDocument } from '../../src/domain/config-center/user-links.js';
import type { AgentServiceRecord, RegisterLinkRecord } from '../../src/domain/account/account-store.js';

export type Row = Record<string, unknown>;

/**
 * 源目录解析：新结构优先；新目录无数据而旧目录有 → 读旧目录并告警。
 *
 * 否则漏跑 `migrate:accounts-layout` 时会**静默迁移 0 条**（看起来成功），这是最危险的失败形态。
 */
export function resolveSourceDir(root: string, relNew: string, relLegacy: string): string {
  const next = path.join(root, ...relNew.split('/'));
  const legacy = path.join(root, relLegacy);
  const hasJson = (dir: string): boolean =>
    fs.existsSync(dir) && fs.readdirSync(dir).some((file) => file.endsWith('.json'));
  if (hasJson(next)) return next;
  if (hasJson(legacy)) {
    console.warn(`[migrate] 新结构 ${relNew}/ 无数据，改读旧目录 ${relLegacy}/（建议先跑 migrate:accounts-layout）`);
    return legacy;
  }
  return next;
}

/** 每类实体的业务列（不含表自增 `id` 与账号的时间列） */
export const COLUMNS = {
  services: ['code', 'name', 'platform_agent_name', 'status', 'created_at', 'updated_at'],
  users: ['user_id', 'phone', 'display_name', 'role', 'password', 'agents', 'source_agent_code'],
  links: ['token', 'agent_code', 'created_by', 'expires_at', 'revoked_at', 'use_count', 'created_at'],
  sessions: ['user_id', 'session_id', 'issued_at'],
} as const;

/**
 * 会话文件的 `issued_at` 是 ISO（UTC），库内统一本地时间字符串。
 *
 * 这是**唯一**转换点：搬运写入与对账比较都调用它，两侧永远同源。
 */
export function isoToLocalDatetime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`无法解析会话签发时间：${iso}`);
  const pad = (value: number, len = 2): string => String(value).padStart(len, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

/** MySQL 存储会重排 JSON 对象键：比较前按有序键递归序列化 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** 空值归一：文件省略字段 ↔ 库内 NULL/空串 */
export function normalize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return canonicalJson(value);
  return String(value);
}

export function serviceRow(service: AgentServiceRecord): Row {
  return {
    code: service.code,
    name: service.name,
    platform_agent_name: service.platform_agent_name,
    status: service.status,
    created_at: service.created_at,
    updated_at: service.updated_at,
  };
}

export function userRow(doc: UserLinkDocument): Row {
  return {
    user_id: doc.user_id,
    phone: doc.phone ?? null,
    display_name: doc.display_name ?? '',
    role: doc.role ?? 'user',
    password: doc.password ?? null,
    agents: doc.agents ?? [],
    source_agent_code: doc.source_agent_code ?? null,
  };
}

export function linkRow(link: RegisterLinkRecord): Row {
  return {
    token: link.token,
    agent_code: link.agent_code,
    created_by: link.created_by ?? null,
    expires_at: link.expires_at ?? null,
    revoked_at: link.revoked_at ?? null,
    use_count: Number(link.use_count ?? 0),
    created_at: link.created_at,
  };
}

export function sessionRow(doc: { user_id: string; session_id: string; issued_at: string }): Row {
  return {
    user_id: doc.user_id,
    session_id: doc.session_id,
    issued_at: isoToLocalDatetime(doc.issued_at),
  };
}

/** 逐列对账：返回差异描述（空数组 = 一致），差异信息带行标识与列名 */
export function diffColumns(rowKey: string, expected: Row, actual: Row | undefined): string[] {
  if (!actual) return [`${rowKey}：库中缺少该行`];
  const problems: string[] = [];
  for (const [column, value] of Object.entries(expected)) {
    if (normalize(value) !== normalize(actual[column])) {
      problems.push(`${rowKey}.${column}：源 ${JSON.stringify(value)} ≠ 库 ${JSON.stringify(actual[column])}`);
    }
  }
  return problems;
}

/** 库内 JSON 列可能以字符串返回（mysql2 版本差异），统一成对象再比较 */
export function normalizeJsonRow(row: Row): Row {
  const out: Row = { ...row };
  for (const column of ['agents', 'password']) {
    const value = out[column];
    if (typeof value === 'string' && value !== '') {
      try {
        out[column] = JSON.parse(value);
      } catch {
        // 非 JSON 字符串：保持原值，由对账报出差异
      }
    }
  }
  return out;
}
