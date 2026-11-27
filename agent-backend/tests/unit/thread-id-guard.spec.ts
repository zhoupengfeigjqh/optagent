import { describe, expect, it } from 'vitest';

import { InvalidThreadIdError, threadDir } from '../../src/domain/dirs.js';

const ROOT = '/srv/opt-agent';
const USER = 'admin';
const AGENT = 'demo';

describe('threadDir —— 会话标识边界', () => {
  it('正常 id（含历史短 id 形态）照常拼接', () => {
    expect(threadDir(ROOT, USER, AGENT, 'th_1')).toContain('th_1');
    expect(threadDir(ROOT, USER, AGENT, '3f2b8c1e-9a4d-4c7e-8f10-11aa22bb33cc')).toContain(
      '3f2b8c1e',
    );
  });

  it.each(['../../evil', '..\\..\\evil', 'a/b', 'a\\b', '..', '.', '', 'x'.repeat(65)])(
    '非法 id %j → 抛 InvalidThreadIdError（不再拼路径）',
    (id) => {
      expect(() => threadDir(ROOT, USER, AGENT, id)).toThrow(InvalidThreadIdError);
    },
  );

  it('错误码固定为 THREAD_ID_INVALID（由 server 映射 400）', () => {
    try {
      threadDir(ROOT, USER, AGENT, '../x');
      expect.unreachable('应当抛错');
    } catch (err) {
      expect((err as InvalidThreadIdError).code).toBe('THREAD_ID_INVALID');
      expect((err as Error).name).toBe('InvalidThreadIdError');
    }
  });
});
