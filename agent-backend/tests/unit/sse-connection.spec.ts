/**
 * 单元测试：SSE 连接的首帧、心跳与释放（2026-11-06）。
 *
 * 守住四件事（都是"容易顺手改坏"的点）：
 * 1. **首帧先行**：建连即写 `: connected`，且早于任何业务事件（这是代理不掐连接的前提）；
 * 2. **心跳按间隔**：到点写 `: ping`；`writableEnded` 后不再写；
 * 3. **释放后静默**：`dispose` / `finish` 之后不再写事件、不再心跳；
 * 4. **幂等**：重复 `finish` 不重复 `end`。
 *
 * 首帧与心跳都是**注释行**，客户端按规范忽略（前端 `sse-parser.ts` 已如此），
 * 故这些帧 MUST NOT 变成业务事件——本条由集成测试再验一次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SSE_HEARTBEAT_MS, openSseConnection } from '../../src/infra/sse.js';

/** 记录写入顺序的假 sink（与真实 `ServerResponse` 的写/结束能力同形） */
function fakeSink(options: { writableEnded?: boolean } = {}) {
  const chunks: string[] = [];
  const state = { ended: 0, writableEnded: options.writableEnded ?? false };
  return {
    chunks,
    state,
    sink: {
      write(chunk: string): boolean {
        chunks.push(chunk);
        return true;
      },
      end(): void {
        state.ended += 1;
        state.writableEnded = true;
      },
      get writableEnded(): boolean {
        return state.writableEnded;
      },
    },
  };
}

describe('openSseConnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('建连即写首帧注释，且先于业务事件', () => {
    const { chunks, sink } = fakeSink();
    const sse = openSseConnection(sink);

    expect(chunks[0]).toBe(': connected\n\n');

    sse.event('content', { delta: '你好' });
    expect(chunks[1]).toBe('event: content\ndata: {"delta":"你好"}\n\n');
  });

  it('心跳按间隔写入注释帧，不产生业务事件', () => {
    const { chunks, sink } = fakeSink();
    openSseConnection(sink);

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS - 1);
    expect(chunks).toEqual([': connected\n\n']);

    vi.advanceTimersByTime(1);
    expect(chunks.at(-1)).toBe(': ping\n\n');

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(chunks.filter((c) => c === ': ping\n\n')).toHaveLength(2);
  });

  it('间隔可注入（测试与特殊部署用），缺省用 SSE_HEARTBEAT_MS', () => {
    const { chunks, sink } = fakeSink();
    openSseConnection(sink, { heartbeatMs: 100 });

    vi.advanceTimersByTime(100);
    expect(chunks.at(-1)).toBe(': ping\n\n');
  });

  it('响应已结束时心跳不再写（避免 write after end）', () => {
    const { chunks, sink, state } = fakeSink({ writableEnded: true });
    openSseConnection(sink);

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 3);
    expect(state.ended).toBe(0);
    expect(chunks).toEqual([': connected\n\n']);
  });

  it('dispose 之后：不再心跳、不再写事件、不结束响应', () => {
    const { chunks, sink, state } = fakeSink();
    const sse = openSseConnection(sink);

    sse.dispose();
    sse.event('content', { delta: 'x' });
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 2);

    expect(chunks).toEqual([': connected\n\n']);
    expect(state.ended).toBe(0);
  });

  it('finish：先清定时器再结束响应，且重复调用只结束一次', () => {
    const { chunks, sink, state } = fakeSink();
    const sse = openSseConnection(sink);

    sse.finish();
    sse.finish();
    sse.event('done', {});
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);

    expect(state.ended).toBe(1);
    expect(chunks).toEqual([': connected\n\n']);
  });
});
