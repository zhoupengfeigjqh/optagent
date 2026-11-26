import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { THREADS_DIR, userDataDir, userDataRoot } from '../../src/domain/dirs.js';
import { removeDirRecursiveAsync } from '../../src/domain/fs-safe.js';
import { buildServer } from '../../src/server';

const SPACES = ['数据准备', '临时空间'] as const;

let app: FastifyInstance | undefined;
let root: string;

function seedLegacyLayout(userId: string, marker: string): void {
  const base = userDataRoot(root, userId);
  for (const space of SPACES) {
    mkdirSync(path.join(base, space), { recursive: true });
    writeFileSync(path.join(base, space, `${marker}-${space}.txt`), `${marker}/${space}`, 'utf8');
  }
  mkdirSync(path.join(base, THREADS_DIR, `th_${marker}`), { recursive: true });
  writeFileSync(
    path.join(base, THREADS_DIR, `th_${marker}`, 'meta.json'),
    JSON.stringify({ thread_id: `th_${marker}`, agent_name: '旧语义' }),
    'utf8',
  );
  writeFileSync(
    path.join(base, THREADS_DIR, `th_${marker}`, 'history.jsonl'),
    '{"role":"user","content":"你好"}\n',
    'utf8',
  );
}

function seedAgent(userId: string, name: string): void {
  const dir = path.join(root, 'users', userId, 'agents', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

function snapshot(userId: string, agentName?: string): Record<string, string> {
  const base =
    agentName === undefined ? userDataRoot(root, userId) : userDataDir(root, userId, agentName);
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(base, abs).split(path.sep).join('/');
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(abs);
      } else {
        out[rel] = readFileSync(abs, 'utf8');
      }
    }
  };
  if (existsSync(base)) walk(base);
  return out;
}

async function startServer(userId = 'admin'): Promise<void> {
  mkdirSync(path.join(root, 'users', userId), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
}

function newRoot(): void {
  root = mkdtempSync(path.join(tmpdir(), 'optagent-migration-'));
}

afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe('启动期迁移（判定②：清单唯一）', () => {
  it('旧布局整体搬进唯一数字人目录，数据逐项一致；用户级落点只剩数字人目录', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    seedAgent('admin', '唯一数字人');
    const legacyBefore = snapshot('admin');
    expect(Object.keys(legacyBefore)).toContain('临时空间/old-临时空间.txt');

    await startServer();

    expect(readdirSync(userDataRoot(root, 'admin'))).toEqual(['唯一数字人']);

    const moved = snapshot('admin', '唯一数字人');
    for (const [rel, content] of Object.entries(legacyBefore)) {
      expect(moved[rel], `迁移后应保留 ${rel}`).toBe(content);
    }
    expect(Object.keys(moved).sort()).toEqual(Object.keys(legacyBefore).sort());
  });

  it('判定③：清单多个且无选中态 → 名称升序第一；其它数字人的数据域不动', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    seedAgent('admin', 'b-数字人');
    seedAgent('admin', 'a-数字人');

    await startServer();

    expect(
      existsSync(path.join(userDataDir(root, 'admin', 'a-数字人'), '临时空间', 'old-临时空间.txt')),
    ).toBe(true);
    expect(existsSync(path.join(userDataDir(root, 'admin', 'b-数字人'), '临时空间'))).toBe(false);
  });

  it('无可用数字人的用户：原地保留 + 不报错（服务照常起来）', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    seedLegacyLayout('bob', 'bob');
    seedAgent('admin', 'admin-数字人');

    await expect(startServer()).resolves.toBeUndefined();

    expect(existsSync(path.join(userDataRoot(root, 'admin'), '临时空间'))).toBe(false);
    expect(existsSync(path.join(userDataRoot(root, 'bob'), '临时空间', 'bob-临时空间.txt'))).toBe(
      true,
    );
  });
});

describe('select 触发的补判（判定①）', () => {
  it('启动时清单为空 → 数据原地保留；部署数字人并 select 后完成迁移', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    await startServer();

    expect(existsSync(path.join(userDataRoot(root, 'admin'), '临时空间'))).toBe(true);

    seedAgent('admin', '迟到数字人');
    const res = await app!.inject({
      method: 'POST',
      url: `/api/agents/${encodeURIComponent('迟到数字人')}/select`,
    });
    expect(res.statusCode).toBe(200);

    expect(
      existsSync(
        path.join(userDataDir(root, 'admin', '迟到数字人'), '临时空间', 'old-临时空间.txt'),
      ),
    ).toBe(true);
    expect(readdirSync(userDataRoot(root, 'admin'))).toEqual(['迟到数字人']);
  });

  it('select 之后**立即可用**：空间列表读得到刚迁进来的文件', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    await startServer();
    seedAgent('admin', '迟到数字人');
    await app!.inject({
      method: 'POST',
      url: `/api/agents/${encodeURIComponent('迟到数字人')}/select`,
    });

    const list = await app!.inject({
      method: 'GET',
      url: `/api/files/list?dir=${encodeURIComponent('临时空间')}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ filename: string }>).map((f) => f.filename)).toEqual([
      'old-临时空间.txt',
    ]);
  });
});

describe('可中断续跑与幂等（FR-041）', () => {
  it('只搬了一半的状态再跑一次：剩下的继续搬，已搬的不重复、不覆盖', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    seedAgent('admin', '唯一数字人');

    // 手工制造"中断"：临时空间已经搬过去了，其余三项目还在旧位。
    // 删除**必须**走 fs-safe 原语：Windows 下 fs.rmSync 对含中文的路径会静默失效
    const dst = userDataDir(root, 'admin', '唯一数字人');
    mkdirSync(path.join(dst, '临时空间'), { recursive: true });
    writeFileSync(path.join(dst, '临时空间', 'old-临时空间.txt'), 'old/临时空间', 'utf8');
    await removeDirRecursiveAsync(path.join(userDataRoot(root, 'admin'), '临时空间'));
    expect(existsSync(path.join(userDataRoot(root, 'admin'), '临时空间'))).toBe(false);
    const movedOnce = snapshot('admin', '唯一数字人');

    await startServer();

    expect(existsSync(path.join(dst, '数据准备', 'old-数据准备.txt'))).toBe(true);
    expect(existsSync(path.join(dst, '临时空间', 'old-临时空间.txt'))).toBe(true);
    expect(existsSync(path.join(dst, THREADS_DIR, 'th_old', 'history.jsonl'))).toBe(true);
    for (const [rel, content] of Object.entries(movedOnce)) {
      expect(snapshot('admin', '唯一数字人')[rel]).toBe(content);
    }
    expect(readdirSync(userDataRoot(root, 'admin'))).toEqual(['唯一数字人']);
  });

  it('再次启动：幂等，数据一动不动（源目录已合并到数字人一级）', async () => {
    newRoot();
    seedLegacyLayout('admin', 'old');
    seedAgent('admin', '唯一数字人');
    await startServer();
    const after1 = snapshot('admin', '唯一数字人');

    await app!.close();
    await startServer();

    expect(snapshot('admin', '唯一数字人')).toEqual(after1);
    expect(readdirSync(userDataRoot(root, 'admin'))).toEqual(['唯一数字人']);
  });
});
