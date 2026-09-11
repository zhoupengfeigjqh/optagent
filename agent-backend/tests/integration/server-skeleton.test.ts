import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { buildServer } from '../../src/server';

type AppInstance = Awaited<ReturnType<typeof buildServer>>;

describe('server 骨架', () => {
  let app: AppInstance;
  let root: string;

  beforeAll(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'optagent-srv-'));
    const configPath = path.join(root, 'config.yaml');
    writeFileSync(configPath, 'models:\n  - model: m1\n');
    const config = loadConfig({
      env: { DEEPSEEK_API_KEY: 'sk-x', OPT_AGENT_ROOT: path.join(root, '.opt-agent') },
      configPath,
    });
    app = await buildServer({ config });
  });
  afterAll(async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('健康探针', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/monitor/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('未知路由 → 404 envelope', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });

  it('业务路由全部落地：无 501 占位（/api/usage/summary 返回空汇总）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/usage/summary' });
    expect(res.statusCode).toBe(200);
    expect(res.json().records).toBe(0);
  });
});
