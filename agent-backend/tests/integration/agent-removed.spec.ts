import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { SPACE_TMP, agentDir, userDataDir } from '../../src/domain/dirs.js';
import { removeDirRecursiveAsync } from '../../src/domain/fs-safe.js';
import { buildServer } from '../../src/server';

const root = mkdtempSync(path.join(tmpdir(), 'optagent-agent-removed-'));
const USER = 'admin';
const AGENT = '订单排程数字人';

let app: FastifyInstance;

function writeAgent(name: string): void {
  const dir = agentDir(root, USER, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

function ctx(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

function select(name: string) {
  return app.inject({ method: 'POST', url: `/api/agents/${encodeURIComponent(name)}/select` });
}

function putFile(space: string, filename: string, content: string): void {
  const abs = path.join(userDataDir(root, USER, AGENT), space, filename);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function snapshotDataTree(): Record<string, string> {
  const base = userDataDir(root, USER, AGENT);
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
  if (statSync(base, { throwIfNoEntry: false })?.isDirectory()) walk(base);
  return out;
}

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', USER), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('数字人被移除：数据保留但不可用（FR-030/031/032）', () => {
  it('移除 → 清单不含、选中被拒、数据逐项不变；重新关联 → 自动恢复可见可用（FR-033）', async () => {
    writeAgent(AGENT);
    expect((await select(AGENT)).statusCode).toBe(200);

    putFile(SPACE_TMP, '订单.csv', '订单号,数量\nA1,10\n');
    putFile('临时空间', 'th_1_产出.json', '{"ok":true}');
    const created = await app.inject({
      method: 'POST',
      url: '/api/threads',
      payload: { agent_name: AGENT },
    });
    expect(created.statusCode).toBe(201);
    const { thread_id: threadId } = created.json() as { thread_id: string };

    const before = snapshotDataTree();
    expect(Object.keys(before).length).toBeGreaterThan(4);

    // 删除**必须**走 fs-safe 原语：Windows 下 fs.rmSync 对含中文的路径会静默失效
    await removeDirRecursiveAsync(agentDir(root, USER, AGENT));
    expect(existsSync(agentDir(root, USER, AGENT))).toBe(false);

    const list = await app.inject({ method: 'GET', url: '/api/agents' });
    const names = (list.json() as Array<{ agent_name: string }>).map((a) => a.agent_name);
    expect(names).not.toContain(AGENT);

    const reselect = await select(AGENT);
    expect(reselect.statusCode).toBe(404);

    // ③ 仍停在它上面（陈旧上下文）→ 文件/会话接口 409 AGENT_NOT_AVAILABLE，MUST NOT 静默成功
    ctx().currentAgent.select(USER, AGENT);
    const files = await app.inject({
      method: 'GET',
      url: `/api/files/list?dir=${encodeURIComponent(SPACE_TMP)}`,
    });
    expect(files.statusCode).toBe(409);
    expect((files.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_AVAILABLE');

    const threads = await app.inject({ method: 'GET', url: '/api/threads' });
    expect(threads.statusCode).toBe(409);
    expect((threads.json() as { error: { code: string } }).error.code).toBe('AGENT_NOT_AVAILABLE');

    expect(snapshotDataTree()).toEqual(before);

    writeAgent(AGENT);
    expect((await select(AGENT)).statusCode).toBe(200);

    const back = await app.inject({
      method: 'GET',
      url: `/api/files/download?dir=${encodeURIComponent(SPACE_TMP)}&filename=${encodeURIComponent('订单.csv')}`,
    });
    expect(back.statusCode).toBe(200);
    expect(back.body).toBe('订单号,数量\nA1,10\n');

    const detail = await app.inject({ method: 'GET', url: `/api/threads/${threadId}` });
    expect(detail.statusCode).toBe(200);

    expect(snapshotDataTree()).toEqual(before);
  });
});
