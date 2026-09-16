/**
 * 部署历史（`FR-033`、`SC-008`，`data-model.md` §7.3）。
 *
 * 追加写 `deploy/history.jsonl`（逐行一条记录），**有界返回**（`FR-006`）。
 * 用 JSONL 而非 JSON 数组：历史是纯追加的，追加写天然不会破坏已写入的记录。
 */
import { randomUUID } from 'node:crypto';
import { PLATFORM_OPERATOR } from '../error-codes.js';
import type { PlatformStore } from '../../infra/platform-store.js';

const REL = 'deploy/history.jsonl';

export interface DeployUserRecord {
  user_id: string;
  ok: boolean;
  agents: Array<{ name: string; action: 'written' | 'removed'; ok: boolean }>;
  error?: string;
}

export interface DeployHistoryRecord {
  id: string;
  deployed_at: string;
  operator: string;
  target_runtime_form: string;
  result: 'succeeded' | 'partial' | 'failed';
  users: DeployUserRecord[];
  validation: { passed: boolean; error_count: number };
  /** 与部署清单不一致的差异（`FR-032`）；结构见 `manifest.ts` 的 `ManifestDiffEntry` */
  manifest_diff: unknown[];
  user_count: number;
  error_count: number;
}

export class DeployHistoryService {
  constructor(private readonly store: PlatformStore) {}

  /** 追加一条部署记录，返回记录 id */
  append(record: Omit<DeployHistoryRecord, 'id' | 'deployed_at' | 'operator'>): string {
    const id = randomUUID();
    const full: DeployHistoryRecord = {
      id,
      deployed_at: new Date().toISOString(),
      // 操作者固定 zyw_admin（research.md D11：本期无登录，仅用于审计字段）
      operator: PLATFORM_OPERATOR,
      ...record,
    };
    this.store.appendJsonl(REL, full);
    return id;
  }

  /** 最近 `limit` 条（时间倒序，**有界返回**） */
  list(limit: number): { items: DeployHistoryRecord[]; truncated: boolean } {
    const all = this.store.readJsonl<DeployHistoryRecord>(REL);
    const desc = [...all].reverse();
    return { items: desc.slice(0, limit), truncated: desc.length > limit };
  }
}
