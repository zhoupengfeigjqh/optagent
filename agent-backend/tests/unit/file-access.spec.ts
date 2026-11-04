/**
 * 单元测试：`FileAccess` 的路径安全边界（2026-10-21 加固回写）。
 *
 * 本文件只钉**这次新增/改动**的两条判据与它们的回归邻域：
 * 1. **盘符前缀一律拒**（含无分隔符的 `C:foo`）——win32 下 `path.isAbsolute('C:foo')`
 *    为 false，属"盘符相对路径"，解析结果取决于进程 cwd；此前只靠后面的
 *    `path.relative` 兜住，现在第一道就判死；
 * 2. **`write_file` 的文件名不得含 `:`**——Windows 上 `a.txt:evil` 是 NTFS 备用数据流：
 *    目录没变，但 `list_dir` 看不到、`read_file` 却能读，等于绕过"文件可见性"。
 *
 * 同时保留三条既有边界作回归（`..` 穿越 / 顶层白名单 / 写入扁平化），
 * 避免以后改这里时把老防线弄丢。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileAccess, PermissionError } from '../../src/domain/file-access.js';

let root: string;
let dataRoot: string;
let access: FileAccess;

/** 写入该数字人的场景清单（数据准备的可见性唯一权威） */
function writeScenario(dirs: string[]): void {
  const agentDir = path.join(root, 'users', 'admin', 'agents', 'demo');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'scenario.json'),
    JSON.stringify({ scenario: '文件访问测试', data_prep_dirs: dirs }),
    'utf8',
  );
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'file-access-'));
  dataRoot = path.join(root, 'users', 'admin', 'user-data', 'demo');
  for (const dir of ['数据准备', '共享空间', '临时空间', 'threads']) {
    fs.mkdirSync(path.join(dataRoot, dir), { recursive: true });
  }
  fs.mkdirSync(path.join(dataRoot, '数据准备', '生产计划'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, '共享空间', '说明.txt'), '共享内容', 'utf8');
  fs.writeFileSync(path.join(dataRoot, 'threads', 'th_1.jsonl'), 'SECRET', 'utf8');
  writeScenario(['生产计划']);
  access = new FileAccess({ optAgentRoot: root, userId: 'admin', agentName: 'demo' });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('FileAccess —— 盘符前缀一律拒（2026-10-21）', () => {
  it('`C:foo`（盘符相对，无分隔符）直接拒，不依赖后续 relative 兜底', async () => {
    await expect(access.read('C:foo')).rejects.toBeInstanceOf(PermissionError);
    await expect(access.read('C:foo')).rejects.toThrow('拒绝绝对路径');
  });

  it('`C:\\Windows\\win.ini` 与 UNC 同样拒（既有行为，保持）', async () => {
    await expect(access.read('C:\\Windows\\win.ini')).rejects.toBeInstanceOf(PermissionError);
    await expect(access.read('\\\\server\\share\\x')).rejects.toBeInstanceOf(PermissionError);
  });
});

describe('FileAccess —— `write_file` 拒绝 NTFS 备用数据流（2026-10-21）', () => {
  it('文件名含 `:` → 拒绝，且不产生任何落盘（含 ADS 宿主文件）', async () => {
    await expect(access.write('th_1', 'th_1_a.txt:evil', 'payload')).rejects.toThrow('不得含 ":"');

    // 冒号若被放行，Windows 会建出 `th_1_a.txt` 的流：文件列表看不见、内容却可读
    expect(fs.existsSync(path.join(dataRoot, '临时空间', 'th_1_a.txt'))).toBe(false);
    expect(fs.readdirSync(path.join(dataRoot, '临时空间'))).toEqual([]);
  });

  it('正常扁平文件名不受影响：写入后可原样读回', async () => {
    const rel = await access.write('th_1', 'th_1_看板.html', '<h1>看板</h1>');

    expect(rel).toBe('临时空间/th_1_看板.html');
    await expect(access.read(rel)).resolves.toMatchObject({ content: '<h1>看板</h1>' });
  });

  it('非法形状仍按既有口径拒（`..` / 无会话前缀）', async () => {
    await expect(access.write('th_1', '../../evil.txt', 'x')).rejects.toBeInstanceOf(
      PermissionError,
    );
    await expect(access.write('th_1', 'no_prefix.txt', 'x')).rejects.toThrow('必须以 "th_1_" 前缀');
  });
});

describe('FileAccess —— 既有边界回归', () => {
  it('`..` 穿越被拒（解析后判定，不靠字符串）', async () => {
    // 越出 dataRoot 才触发"穿越"；`临时空间/../threads/…` 仍在 dataRoot 内，
    // 由顶层白名单拦（下一条用例），两道判据各管一段
    await expect(access.read('临时空间/../../secret.txt')).rejects.toThrow('路径穿越被拒绝');
  });

  it('顶层白名单：会话历史与配置目录都不可达（内容不泄露）', async () => {
    await expect(access.read('threads/th_1.jsonl')).rejects.toThrow('目录不在白名单');
    await expect(access.read('skills/SKILL.md')).rejects.toThrow('目录不在白名单');
  });

  it('数据准备：缺二级目录 / 清单外目录被拒，清单内可读', async () => {
    await expect(access.list('数据准备')).rejects.toBeInstanceOf(PermissionError);
    await expect(access.list('数据准备')).rejects.toThrow('数据准备需指定二级目录');
    await expect(access.read('数据准备/已下线/x.csv')).rejects.toThrow('不在场景清单');

    fs.writeFileSync(path.join(dataRoot, '数据准备', '生产计划', 'x.csv'), 'a,b', 'utf8');
    await expect(access.read('数据准备/生产计划/x.csv')).resolves.toMatchObject({ content: 'a,b' });
  });

  it('`writeProduced` 只允许 `临时空间/后台产出`（落点锁死）', async () => {
    await expect(access.writeProduced('共享空间', 'x.json', Buffer.from('{}'))).rejects.toThrow(
      '后台产出只允许写入',
    );
  });
});

describe('FileAccess —— 判据收敛后与浏览接口同口径（2026-11-02）', () => {
  it('场景清单收缩后：磁盘仍在的旧目录读不到（部署不清理文件空间）', async () => {
    const legacy = path.join(dataRoot, '数据准备', '已下线');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, '2026-10计划.csv'), '旧数据', 'utf8');

    // 清单里没有它 ⇒ 与前端一致地拒（此前只看"磁盘上存在"，故能读到）
    await expect(access.read('数据准备/已下线/2026-10计划.csv')).rejects.toThrow('不在场景清单');
    await expect(access.list('数据准备/已下线')).rejects.toThrow('不在场景清单');
  });

  it('共享空间深层目录读不到，且 `list_dir` 不再列出（不留"看得见点不开"）', async () => {
    const deep = path.join(dataRoot, '共享空间', '2026');
    fs.mkdirSync(deep, { recursive: true });
    fs.writeFileSync(path.join(deep, '报价单.xlsx'), 'x', 'utf8');

    await expect(access.read('共享空间/2026/报价单.xlsx')).rejects.toThrow('不支持子目录');
    // 词法上 `共享空间/2026` 是"一层条目"，但它是目录 ⇒ 不可下钻（stat 之后判）
    await expect(access.list('共享空间/2026')).rejects.toThrow('不支持子目录');

    const names = (await access.list('共享空间')).map((e) => e.name);
    expect(names).toContain('说明.txt');
    expect(names).not.toContain('2026');
  });

  it('`临时空间/后台产出` 仍可被模型取回（登记例外，产出功能不受影响）', async () => {
    await access.writeProduced('临时空间/后台产出', 'ocr_7f3a.json', Buffer.from('{"ok":true}'));

    await expect(access.read('临时空间/后台产出/ocr_7f3a.json')).resolves.toMatchObject({
      content: '{"ok":true}',
    });
    await expect(access.list('临时空间/后台产出')).resolves.toHaveLength(1);
  });

  it('`grep_files` 不把清单外目录纳入检索（否则收紧会被一键绕过）', async () => {
    const legacy = path.join(dataRoot, '数据准备', '已下线');
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, '旧.csv'), '排产冲突', 'utf8');
    fs.writeFileSync(path.join(dataRoot, '数据准备', '生产计划', '新.csv'), '排产冲突', 'utf8');

    const { matches } = await access.grep('排产');

    expect(matches.map((m) => m.file)).toEqual(['数据准备/生产计划/新.csv']);
  });

  it('写入仍只能落 `临时空间` 顶层（写方向零变化）', async () => {
    const rel = await access.write('th_1', 'th_1_a.csv', 'x');

    expect(rel).toBe('临时空间/th_1_a.csv');
    expect(fs.existsSync(path.join(dataRoot, '临时空间', 'th_1_a.csv'))).toBe(true);
  });
});
