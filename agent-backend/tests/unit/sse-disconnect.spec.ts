/**
 * 单元测试：SSE 断连钩子（2026-11-26，S1 加固）。
 *
 * 关键不变式（实测依据）：Node ≥16 服务端 `req` 的 `close` 在**请求体读完**时就触发，
 * 客户端断开只体现在 `res` 上 —— 所以钩子必须挂 `reply.raw`，且清理必须幂等
 * （正常 `finish()` 之后 `res` 也会 `close`）。
 */
import { describe, expect, it } from 'vitest';

import { onSseDisconnect, type SseRawSink } from '../../src/infra/sse.js';

/** 带事件能力的假 sink（真实 `ServerResponse` 的 `once` 同形；`inject` 的假 Response 没有） */
function emitterSink() {
  const listeners = new Map<string, Array<() => void>>();
  const sink: SseRawSink = {
    write: () => true,
    end: () => undefined,
    once(event, listener) {
      const list = listeners.get(event) ?? [];
      list.push(listener);
      listeners.set(event, list);
      return this;
    },
  };
  return {
    sink,
    emit(event: 'close' | 'error') {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

describe('onSseDisconnect', () => {
  it('close → 清理一次；重复 close 不重复执行', () => {
    const { sink, emit } = emitterSink();
    let cleaned = 0;

    onSseDisconnect(sink, () => {
      cleaned += 1;
    });

    emit('close');
    emit('close');
    expect(cleaned).toBe(1);
  });

  it('error 同样触发清理（socket 异常断开不只有 close）', () => {
    const { sink, emit } = emitterSink();
    let cleaned = 0;

    onSseDisconnect(sink, () => {
      cleaned += 1;
    });

    emit('error');
    expect(cleaned).toBe(1);
  });

  it('没有事件能力的 sink（app.inject 的假 Response）不抛错', () => {
    const sink: SseRawSink = { write: () => true, end: () => undefined };
    expect(() => onSseDisconnect(sink, () => undefined)).not.toThrow();
  });
});
