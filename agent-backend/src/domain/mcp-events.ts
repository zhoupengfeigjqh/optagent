/**
 * MCP 连接状态变更的进程内事件总线（domain 层）。
 *
 * 事件语义：`changed(userId)` 表示"该用户的 MCP 状态快照可能已变化"，
 * 订阅方（SSE 路由）收到后重新计算当前选中数字人的快照并推送。
 * 触发源：
 * - 实例建连落定（connectAll 单 server 成功/失败，经 agent-factory 转发）
 * - 覆盖式 select / exit（选中数字人变化 → 快照随之变化）
 *
 * 单用户桌面应用，监听器数量极小，直接用 EventEmitter 即可；
 * 独立成类仅为收窄事件名与负载类型，避免魔法字符串扩散。
 */
import { EventEmitter } from 'node:events';

const CHANGED = 'changed';

export class McpStatusEvents {
  private readonly emitter = new EventEmitter();

  emitChanged(userId: string): void {
    this.emitter.emit(CHANGED, userId);
  }

  /** 订阅变更；返回退订函数（SSE 连接关闭时调用，防泄漏） */
  onChanged(listener: (userId: string) => void): () => void {
    this.emitter.on(CHANGED, listener);
    return () => {
      this.emitter.off(CHANGED, listener);
    };
  }
}
