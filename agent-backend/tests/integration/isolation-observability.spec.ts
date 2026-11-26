import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { SPACE_TMP, agentDir, userDataDir } from '../../src/domain/dirs.js';
import { removeDirRecursiveAsync, removeFileSafeAsync } from '../../src/domain/fs-safe.js';
import { agentScopedPath, mintPutUrl } from '../../src/infra/file-sign.js';
import { buildServer } from '../../src/server';

const SECRET = 'test-secret-observability';
const root = mkdtempSync(path.join(tmpdir(), 'optagent-observability-'));
const USER = 'admin';
const AGENT = 'demo';

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

function loggedEvent(
  warn: ReturnType<typeof vi.spyOn>,
  event: string,
): Record<string, unknown> | undefined {
  const hit = warn.mock.calls.find((c) => (c[0] as { event?: string })?.event === event);
  return hit?.[0] as Record<string, unknown> | undefined;
}

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', USER), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: {
      PUBLIC_BASE_URL: 'http://backend:3000',
      OPT_AGENT_ROOT: root,
      FILE_SIGN_SECRET: SECRET,
    },
    configPath,
  });
  app = await buildServer({ config });
  writeAgent(AGENT);
  expect((await select(AGENT)).statusCode).toBe(200);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('越界目录拒绝：结构化日志含用户/数字人/请求线索（FR-051）', () => {
  it('点名别的数字人当一级目录 → 403 且落 dir.validation.rejected', async () => {
    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/files/list?dir=${encodeURIComponent(`别的数字人/${SPACE_TMP}`)}`,
      });
      expect(res.statusCode).toBe(403);

      expect(loggedEvent(warn, 'dir.validation.rejected')).toMatchObject({
        user_id: USER,
        agent_name: AGENT,
        dir: `别的数字人/${SPACE_TMP}`,
        status_code: 403,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('路径穿越 → 400 且同样落结构化日志（reason 可读）', async () => {
    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/files/list?dir=${encodeURIComponent('../临时空间')}`,
      });
      expect(res.statusCode).toBe(400);

      const fields = loggedEvent(warn, 'dir.validation.rejected');
      expect(fields).toMatchObject({ user_id: USER, agent_name: AGENT, status_code: 400 });
      expect(typeof fields?.reason).toBe('string');
    } finally {
      warn.mockRestore();
    }
  });

  it('回写目录越界（签名合法但目录不对）→ 400 且落结构化日志', async () => {
    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const url = `${mintPutUrl(
        'http://backend:3000',
        SECRET,
        USER,
        agentScopedPath(AGENT, SPACE_TMP),
        {},
      )}&filename=越界.json`;
      const res = await app.inject({ method: 'POST', url, payload: { ok: true } });
      expect(res.statusCode).toBe(400);

      expect(loggedEvent(warn, 'dir.validation.rejected')).toMatchObject({
        user_id: USER,
        agent_name: AGENT,
        status_code: 400,
        reason: 'not_produced_dir',
      });
    } finally {
      warn.mockRestore();
    }
  });
});

describe('数字人数据目录不可用：可读错误且**零回退**（FR-051，T046）', () => {
  it('空间路径被占成文件 → 写入失败返回错误，且**不**在用户级落任何东西', async () => {
    writeAgent('坏目录数字人');
    expect((await select('坏目录数字人')).statusCode).toBe(200);

    // 把该数字人的「临时空间」做成一个**文件**（模拟"数字人目录不可写/不可用"）：
    // Windows 下无法用 chmod 可靠模拟不可写，用"路径被占"即可触发同一条失败路径
    const spacePath = path.join(userDataDir(root, USER, '坏目录数字人'), SPACE_TMP);
    await removeDirRecursiveAsync(spacePath);
    writeFileSync(spacePath, 'not a dir', 'utf8');

    const boundary = '----vitest-unwritable';
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="dir"\r\n\r\n${SPACE_TMP}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="probe.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      Buffer.from('x', 'utf8'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/api/files/upload',
      payload: body,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((res.json() as { error: { code: string } }).error.code).toBeTruthy();

    // **零回退**：用户级绝不能出现同名空间（否则隔离看起来正常、实际失效）
    expect(existsSync(path.join(root, 'users', USER, 'user-data', SPACE_TMP))).toBe(false);

    // 收尾：恢复成目录，避免影响后续用例
    await removeFileSafeAsync(spacePath);
    expect((await select(AGENT)).statusCode).toBe(200);
  });
});

describe('降级：陈旧数字人被拒的原因可观测、响应可读（FR-032/051/052）', () => {
  it('已移除的数字人 → 409 可读文案 + agent.scope.unavailable 带 reason', async () => {
    writeAgent('临时数字人');
    expect((await select('临时数字人')).statusCode).toBe(200);
    // 删除**必须**走 fs-safe 原语：Windows 下 fs.rmSync 对含中文的路径会静默失效
    await removeDirRecursiveAsync(agentDir(root, USER, '临时数字人'));
    expect(existsSync(agentDir(root, USER, '临时数字人'))).toBe(false);

    const warn = vi.spyOn(ctx().loggers.logger, 'warn');
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/api/files/list?dir=${encodeURIComponent(SPACE_TMP)}`,
      });

      expect(res.statusCode).toBe(409);
      const body = res.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('AGENT_NOT_AVAILABLE');
      expect(body.error.message).toContain('请重新选择');

      const fields = loggedEvent(warn, 'agent.scope.unavailable');
      expect(fields).toMatchObject({
        user_id: USER,
        agent_name: '临时数字人',
        route: 'files',
      });
      expect(typeof fields?.reason).toBe('string');
    } finally {
      warn.mockRestore();
    }

    expect((await select(AGENT)).statusCode).toBe(200);
  });
});
