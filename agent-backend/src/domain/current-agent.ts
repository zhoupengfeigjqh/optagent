import type { PoolKey } from '../types.js';

export class CurrentAgentStore {
  private readonly selected = new Map<string, string>();

  /** 选中数字人（覆盖式）：重复 select 同一数字人幂等；选中他人直接覆盖 */
  select(userId: string, agentName: string): PoolKey {
    this.selected.set(userId, agentName);
    return { userId, agentName };
  }

  /** 退出选中；未选中时幂等 */
  exit(userId: string): void {
    this.selected.delete(userId);
  }

  current(userId: string): PoolKey | undefined {
    const agentName = this.selected.get(userId);
    return agentName ? { userId, agentName } : undefined;
  }
}
