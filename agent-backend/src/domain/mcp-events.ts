import { EventEmitter } from 'node:events';

const CHANGED = 'changed';

export class McpStatusEvents {
  private readonly emitter = new EventEmitter();

  emitChanged(userId: string): void {
    this.emitter.emit(CHANGED, userId);
  }

  onChanged(listener: (userId: string) => void): () => void {
    this.emitter.on(CHANGED, listener);
    return () => {
      this.emitter.off(CHANGED, listener);
    };
  }
}
