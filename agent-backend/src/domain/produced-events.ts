/**
 * 后台产出变更的进程内事件总线（R11，契约 §10.5 ①）。
 *
 * 事件语义：`changed(userId)` 表示"该用户的产出清单**可能**已变"——**负载为空**，
 * 是纯信号。这样设计的前提是"产出物本身是文件，有哪些可从目录重算"：
 * 信号丢失（前端断连、进程重启）**无后果**，离线期间到达的产出在下次打开页面时
 * 由列表接口读出。
 *
 * 与 `McpStatusEvents` 同构（单用户桌面应用，监听器数量极小，直接用 EventEmitter）。
 */
import { EventEmitter } from 'node:events';

const CHANGED = 'changed';

export class ProducedEvents {
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
