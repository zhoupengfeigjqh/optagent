/**
 * 用户当前选中数字人状态（内存 Map）。
 *
 * 规则：1 用户同时最多选中 1 个；`select` 为**覆盖式**语义——
 * 重复 select 同一数字人幂等，选中他人时**直接覆盖**，无需先 `exit`。
 * 切换不销毁实例、不影响进行中的 run，新数字人在**下一轮对话**时激活。
 * `exit` 仅清除选中态（未选中时幂等），供「退出当前数字人」入口使用。
 */
import type { PoolKey } from '../types.js';

export class CurrentAgentStore {
  private readonly selected = new Map<string, string>(); // userId -> agentName

  /** 选中数字人（覆盖式）：重复 select 同一数字人幂等；选中他人直接覆盖 */
  select(userId: string, agentName: string): PoolKey {
    this.selected.set(userId, agentName);
    return { userId, agentName };
  }

  /** 退出选中；未选中时幂等 */
  exit(userId: string): void {
    this.selected.delete(userId);
  }

  /** 查询当前选中；未选中返回 undefined */
  current(userId: string): PoolKey | undefined {
    const agentName = this.selected.get(userId);
    return agentName ? { userId, agentName } : undefined;
  }
}
