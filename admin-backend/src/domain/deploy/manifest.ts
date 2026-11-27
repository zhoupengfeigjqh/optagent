import type { PlatformStore } from '../../infra/platform-store.js';

const REL = 'deploy/manifest.json';

export interface ManifestEntry {
  user_id: string;
  agent_names: string[];
  last_deployed_at: string;
}

interface Document {
  entries: ManifestEntry[];
}

export interface ManifestDiffEntry {
  user_id: string;
  target: string;
  kind:
    | 'missing_in_runtime'
    | 'unexpected_in_runtime'
    | 'agent_missing_in_runtime'
    | 'agent_new_in_runtime'
    | 'agent_unexpected_in_runtime';
  detail: string;
}

export class DeployManifestService {
  constructor(private readonly store: PlatformStore) {}

  read(): ManifestEntry[] {
    const doc = this.store.readJson<Document>(REL);
    return Array.isArray(doc?.entries) ? doc.entries : [];
  }

  get(userId: string): ManifestEntry | null {
    return this.read().find((entry) => entry.user_id === userId) ?? null;
  }

  save(entries: ManifestEntry[]): void {
    this.store.writeJson(REL, { entries } satisfies Document);
  }

  updateUser(userId: string, agentNames: string[], deployedAt: string): void {
    const others = this.read().filter((entry) => entry.user_id !== userId);
    this.save(
      [
        ...others,
        { user_id: userId, agent_names: [...agentNames].sort(), last_deployed_at: deployedAt },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id, 'zh-Hans-CN')),
    );
  }

  removeUser(userId: string): void {
    this.save(this.read().filter((entry) => entry.user_id !== userId));
  }

  diff(userId: string, desiredAgents: string[], runtimeAgents: string[]): ManifestDiffEntry[] {
    const runtime = new Set(runtimeAgents);
    const desired = new Set(desiredAgents);
    const managed = new Set(this.get(userId)?.agent_names ?? []);
    const out: ManifestDiffEntry[] = [];

    for (const agent of desired) {
      if (runtime.has(agent)) continue;
      // "期望有、运行环境缺"再按清单归属细分：清单分发过 → 被删/下架；否则 → 本次新增
      if (managed.has(agent)) {
        out.push({
          user_id: userId,
          target: agent,
          kind: 'agent_missing_in_runtime',
          detail: `用户 ${userId} 的运行环境中缺少数字人目录 ${agent}（可能被手工删除）`,
        });
      } else {
        out.push({
          user_id: userId,
          target: agent,
          kind: 'agent_new_in_runtime',
          detail: `用户 ${userId} 本次将新增数字人 ${agent}`,
        });
      }
    }
    for (const agent of runtimeAgents) {
      if (managed.has(agent) && !desired.has(agent)) {
        out.push({
          user_id: userId,
          target: agent,
          kind: 'agent_unexpected_in_runtime',
          detail: `运行环境中的 ${agent} 由本平台分发过、但已不再需要，将在本次部署中移除`,
        });
      }
    }
    return out;
  }
}
