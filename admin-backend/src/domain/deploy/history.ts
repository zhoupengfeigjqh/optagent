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
  result: 'succeeded' | 'partial' | 'failed';
  users: DeployUserRecord[];
  validation: { passed: boolean; error_count: number };
  manifest_diff: unknown[];
  user_count: number;
  error_count: number;
}

export class DeployHistoryService {
  constructor(private readonly store: PlatformStore) {}

  append(record: Omit<DeployHistoryRecord, 'id' | 'deployed_at' | 'operator'>): string {
    const id = randomUUID();
    const full: DeployHistoryRecord = {
      id,
      deployed_at: new Date().toISOString(),
      operator: PLATFORM_OPERATOR,
      ...record,
    };
    this.store.appendJsonl(REL, full);
    return id;
  }

  list(limit: number): { items: DeployHistoryRecord[]; truncated: boolean } {
    const all = this.store.readJsonl<DeployHistoryRecord>(REL);
    const desc = [...all].reverse();
    return { items: desc.slice(0, limit), truncated: desc.length > limit };
  }
}
