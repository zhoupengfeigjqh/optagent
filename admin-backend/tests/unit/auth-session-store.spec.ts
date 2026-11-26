import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/domain/auth/session-store.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;
let sessions: SessionStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'session-store-'));
  const store = new PlatformStore(root);
  store.ensureLayout();
  sessions = new SessionStore(store);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('登记→读取→判定', () => {
    expect(sessions.getCurrentSession('zpf')).toBeNull();
    sessions.setCurrentSession('zpf', 's1');
    expect(sessions.getCurrentSession('zpf')).toBe('s1');
    expect(sessions.isCurrentSession('zpf', 's1')).toBe(true);
    expect(sessions.isCurrentSession('zpf', 's2')).toBe(false);
  });

  it('覆盖旧会话（后登踢前登）', () => {
    sessions.setCurrentSession('zpf', 's1');
    sessions.setCurrentSession('zpf', 's2');
    expect(sessions.isCurrentSession('zpf', 's1')).toBe(false);
    expect(sessions.isCurrentSession('zpf', 's2')).toBe(true);
  });

  it('清除会话且幂等', () => {
    sessions.setCurrentSession('zpf', 's1');
    sessions.clearSession('zpf');
    expect(sessions.getCurrentSession('zpf')).toBeNull();
    expect(() => sessions.clearSession('zpf')).not.toThrow();
  });
});
