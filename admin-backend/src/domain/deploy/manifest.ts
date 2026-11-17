/**
 * 部署清单（`FR-031`、`FR-032`，`data-model.md` §7.1）。
 *
 * 清单记录"平台实际给哪些用户分发过哪些数字人、最近一次是什么时候"，
 * 用于：①用户卡片上的部署状态（`deployed_at`，见 `routes/users.ts`）；
 * ②与运行环境的**差异报告**（`FR-032`）——被手工删改过的目录要报出来。
 *
 * **2026-09-16 起"移除"不再以清单为准**：`agents/` 由部署**整体覆盖**
 * （本次不在列的一切条目都会被清掉，见 `infra/opt-agent-writer.ts`）。
 * 原因是"按清单移除"的做法在清单缺失/被手工改过时会让旧目录永远留下，
 * 表现为"部署后删不掉该用户的数字人"。
 */
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

  /** 写回清单（整体替换；清单本身是平台设计态的一部分） */
  save(entries: ManifestEntry[]): void {
    this.store.writeJson(REL, { entries } satisfies Document);
  }

  /** 合并单个用户的条目（部署成功后调用） */
  updateUser(userId: string, agentNames: string[], deployedAt: string): void {
    const others = this.read().filter((entry) => entry.user_id !== userId);
    this.save(
      [
        ...others,
        { user_id: userId, agent_names: [...agentNames].sort(), last_deployed_at: deployedAt },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id, 'zh-Hans-CN')),
    );
  }

  /** 移除单个用户的条目（**撤回部署**后调用：用户卡片随即显示"未部署"） */
  removeUser(userId: string): void {
    this.save(this.read().filter((entry) => entry.user_id !== userId));
  }

  /**
   * 与运行环境的差异（`FR-032`）。
   *
   * - 期望有、运行环境缺、清单里**分发过** → 被手工删除/下架（`agent_missing_in_runtime`）；
   * - 期望有、运行环境缺、清单里**没有** → 本次新增（`agent_new_in_runtime`，2026-11-17）；
   * - 运行环境有、清单里分发过、本次不再需要 → 将被移除（`agent_unexpected_in_runtime`）；
   * - 运行环境有、清单里没有 → 非本平台分发的内容（不报出，但下次部署会被整体覆盖清掉，
   *   因为 `agents/` 现在以本次产物为准，见 `infra/opt-agent-writer.ts`）。
   */
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
