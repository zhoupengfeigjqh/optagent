/**
 * 002 US7 工作空间汇总集成测试（T030）：
 * GET /api/files/workspace 返回全部 9 个白名单目录（7 业务+shared+tmp）；
 * 空目录 files=[]；有文件目录含 filename/size/updated_at 元数据。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';
import { BUSINESS_DIRS, userDataDir } from '../../src/domain/dirs';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

describe('工作空间汇总（002 US7 / T030）', () => {
  let root: string;
  let app: AppInstance;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-ws-'));
    const agentDir = path.join(root, '.opt-agent', 'users', 'admin', 'agents', 'demo');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(path.join(agentDir, 'SOUL.md'), '你是 demo。');
    writeFileSync(path.join(agentDir, 'TOOL.json'), JSON.stringify({ enabled: [] }));
    writeFileSync(path.join(agentDir, 'MCP.json'), JSON.stringify({ servers: [] }));
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    app = await buildServer({ config });
    const dataDir = userDataDir(config.optAgentRoot, 'admin');
    mkdirSync(path.join(dataDir, '生产计划'), { recursive: true });
    writeFileSync(path.join(dataDir, '生产计划', 'plan.csv'), 'a,b');
    writeFileSync(path.join(dataDir, '生产计划', 'plan2.xlsx'), 'PK');
  });
  afterEach(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('返回 9 个白名单目录，含全部业务目录 + shared + tmp', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { dirs: Array<{ dir: string; files: unknown[] }> };
    expect(body.dirs).toHaveLength(9);
    const names = body.dirs.map((d) => d.dir);
    for (const d of [...BUSINESS_DIRS, 'shared', 'tmp']) {
      expect(names).toContain(d);
    }
    expect(names).not.toContain('threads');
  });

  it('有文件目录含元数据；空目录 files=[]', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/files/workspace' });
    const body = res.json() as {
      dirs: Array<{ dir: string; files: Array<{ filename: string; size: number; updated_at: string }> }>;
    };
    const prod = body.dirs.find((d) => d.dir === '生产计划')!;
    expect(prod.files).toHaveLength(2);
    for (const f of prod.files) {
      expect(f.filename).toBeTruthy();
      expect(typeof f.size).toBe('number');
      expect(f.updated_at).toBeTruthy();
    }
    const emptyDir = body.dirs.find((d) => d.dir === '产线信息')!;
    expect(emptyDir.files).toEqual([]);
  });
});
