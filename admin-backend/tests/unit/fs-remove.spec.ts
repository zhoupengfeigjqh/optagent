import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeTree } from '../../src/infra/fs-remove.js';
import { PlatformStore } from '../../src/infra/platform-store.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-remove-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('removeTree —— 中文路径的可靠删除', () => {
  it('中文名文件：删除后消失（修复前 rmSync 会把它静默留下）', () => {
    const file = path.join(root, '海大生产计划助手.json');
    fs.writeFileSync(file, '{}');
    removeTree(file);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('中文名嵌套目录树：整棵删除（含只读文件）', () => {
    const deep = path.join(root, '生产调度', '原材料采购和库存');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(root, '生产调度', 'note.txt'), 'x');
    const yaml = path.join(deep, 'ontology.yaml');
    fs.writeFileSync(yaml, 'x');
    fs.chmodSync(yaml, 0o444);

    removeTree(path.join(root, '生产调度'));

    expect(fs.existsSync(path.join(root, '生产调度'))).toBe(false);
  });

  it('目标不存在：幂等，不抛错', () => {
    expect(() => removeTree(path.join(root, '不存在.json'))).not.toThrow();
    expect(() => removeTree(path.join(root, '不存在的目录'))).not.toThrow();
  });

  it('符号链接只删链接本身，不跟进目标目录', () => {
    const target = path.join(root, '真实目录');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'keep.txt'), 'x');
    const link = path.join(root, '链接');
    try {
      fs.symlinkSync(target, link, 'dir');
    } catch {
      return; // 宿主不允许建符号链接（Windows 未开开发者模式）：跳过，不作失败
    }

    removeTree(link);

    expect(fs.existsSync(link)).toBe(false);
    expect(fs.existsSync(path.join(target, 'keep.txt'))).toBe(true);
  });

  it('端到端：PlatformStore.remove 删中文名数字人后，磁盘文件真的消失', () => {
    const store = new PlatformStore(root);
    store.ensureLayout();
    store.writeJson('agents/海大生产计划助手.json', { name: '海大生产计划助手' });

    store.remove('agents/海大生产计划助手.json');

    expect(store.exists('agents/海大生产计划助手.json')).toBe(false);
    expect(fs.existsSync(path.join(root, 'agents', '海大生产计划助手.json'))).toBe(false);
  });
});
