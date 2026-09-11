import fs from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUSINESS_DIRS,
  ensureRootDirs,
  ensureUserDirs,
  threadDir,
  userDataDir,
} from '../../src/domain/dirs';

describe('目录初始化', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-dirs-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('创建 7 业务目录 + tmp + shared + threads + agents', () => {
    ensureUserDirs(root, 'admin');
    const data = userDataDir(root, 'admin');
    for (const dir of [...BUSINESS_DIRS, 'tmp', 'shared', 'threads']) {
      expect(fs.statSync(path.join(data, dir)).isDirectory()).toBe(true);
    }
    expect(fs.statSync(path.join(root, 'users', 'admin', 'agents')).isDirectory()).toBe(true);
  });

  it('重复初始化幂等，已有内容保留', () => {
    ensureUserDirs(root, 'admin');
    const file = path.join(userDataDir(root, 'admin'), 'tmp', 'keep.txt');
    fs.writeFileSync(file, 'data');
    ensureUserDirs(root, 'admin');
    ensureRootDirs(root, ['admin']);
    expect(fs.readFileSync(file, 'utf8')).toBe('data');
  });

  it('ensureRootDirs 创建根目录并初始化多用户', () => {
    const nested = path.join(root, 'deep', '.opt-agent');
    ensureRootDirs(nested, ['a', 'b']);
    expect(fs.statSync(userDataDir(nested, 'a')).isDirectory()).toBe(true);
    expect(fs.statSync(userDataDir(nested, 'b')).isDirectory()).toBe(true);
  });

  it('threadDir 位于 user-data/threads 下', () => {
    expect(threadDir(root, 'admin', 't1')).toBe(
      path.join(root, 'users', 'admin', 'user-data', 'threads', 't1'),
    );
  });
});
