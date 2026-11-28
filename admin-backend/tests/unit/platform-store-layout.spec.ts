/**
 * 目录骨架（029 FR-027）：mysql 驱动的账号域不在文件系统，不得建空目录、不得误告警。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PlatformStore } from '../../src/infra/platform-store.js';

type LogLine = { event?: string };

let root: string;
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-'));
  lines = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('PlatformStore.ensureLayout', () => {
  it('缺省（file 驱动）建账号域目录与 meta.json', () => {
    new PlatformStore(root).ensureLayout();
    for (const dir of ['accounts', 'accounts/users', 'accounts/sessions', 'agents', 'skills']) {
      expect(fs.existsSync(path.join(root, dir)), dir).toBe(true);
    }
    expect(fs.existsSync(path.join(root, 'meta.json'))).toBe(true);
  });

  it('accounts:false（mysql 驱动）不建账号域目录，其余骨架照建', () => {
    new PlatformStore(root).ensureLayout({ accounts: false });
    expect(fs.existsSync(path.join(root, 'accounts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'agents'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'meta.json'))).toBe(true);
  });

  it('accounts:false 时旧目录存在也不告警', () => {
    fs.mkdirSync(path.join(root, 'users'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
    new PlatformStore(root, { logger: memoryLogger() }).ensureLayout({ accounts: false });
    expect(lines.filter((line) => line.event === 'store.layout.legacy')).toHaveLength(0);
  });

  it('缺省时旧目录存在要告警（迁移未跑，不静默双份数据）', () => {
    fs.mkdirSync(path.join(root, 'users'), { recursive: true });
    fs.mkdirSync(path.join(root, 'sessions'), { recursive: true });
    new PlatformStore(root, { logger: memoryLogger() }).ensureLayout();
    expect(lines.filter((line) => line.event === 'store.layout.legacy')).toHaveLength(2);
  });
});
