import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThrottledWarn } from '../../src/logging.js';

type LogLine = Record<string, unknown>;

let lines: LogLine[];

function memoryLogger() {
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const line of String(chunk).split('\n')) {
        if (line.trim() !== '') lines.push(JSON.parse(line) as LogLine);
      }
      cb();
    },
  });
  return pino({ level: 'info' }, stream);
}

beforeEach(() => {
  lines = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottledWarn —— 同一消息窗口内只告警一次', () => {
  it('重复消息被合并，并在下一条里报出被合并的次数', () => {
    const warn = createThrottledWarn(memoryLogger(), 'agent.config.invalid', 60_000);

    warn.warn('数字人 demo 配置损坏：transport 非法');
    warn.warn('数字人 demo 配置损坏：transport 非法');
    warn.warn('数字人 demo 配置损坏：transport 非法');

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'agent.config.invalid', scope: 'system', alert: true });

    vi.advanceTimersByTime(60_001);
    warn.warn('数字人 demo 配置损坏：transport 非法');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ suppressed: 2 });
    expect(String(lines[1]?.msg)).toContain('已合并');
  });

  it('不同消息各自独立计数（一个数字人坏了不影响另一个的告警）', () => {
    const warn = createThrottledWarn(memoryLogger(), 'agent.config.invalid', 60_000);

    warn.warn('数字人 demo 配置损坏');
    warn.warn('数字人 demo2 配置损坏');
    warn.warn('数字人 demo 配置损坏');

    expect(lines.map((l) => l.msg)).toEqual(['数字人 demo 配置损坏', '数字人 demo2 配置损坏']);
  });

  it('窗口内的第一条不带 suppressed（没有合并发生时不留噪声字段）', () => {
    const warn = createThrottledWarn(memoryLogger(), 'agent.config.invalid', 60_000);
    warn.warn('坏配置');

    expect(lines[0]?.suppressed).toBeUndefined();
  });
});
