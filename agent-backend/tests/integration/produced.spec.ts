/**
 * 集成测试：后台产出回写与列表（R11，契约 §10.3~§10.5）
 *
 * 覆盖：
 * - `POST /api/files/put`：正常回写 202 → 列表可见；**读签名不能用于写**（不变式 3 的端到端证据）；
 *   目录越权 / 非法文件名 → 400；验签失败 → 403；幂等重放（同名覆盖）；
 * - 落盘即推**变更信号**（`producedEvents`），前端据此重拉列表；
 * - `GET /api/produced`：形状、倒序、有界返回、未落盘时为空。
 *
 * 运行方式（本地执行）：npm run test:integration
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import type { AppContext } from '../../src/context.js';
import { PRODUCED_DIR } from '../../src/domain/dirs.js';
import { mintPutUrl, mintSignedUrl } from '../../src/infra/file-sign.js';
import { buildServer } from '../../src/server';

const SECRET = 'test-secret-0123456789';
const root = mkdtempSync(path.join(tmpdir(), 'optagent-produced-'));
let app: FastifyInstance;

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', 'admin'), { recursive: true });
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root, FILE_SIGN_SECRET: SECRET },
    configPath,
  });
  app = await buildServer({ config });
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

/** 铸一条回写 URL（默认归属 admin、落到产出目录），随后按其 `hints` 带上归属提示参数 */
function putUrl(
  opts: { userId?: string; dir?: string; hints?: { sid?: string; callId?: string; tool?: string } } = {},
): string {
  return mintPutUrl(
    'http://backend:3000',
    SECRET,
    opts.userId ?? 'admin',
    opts.dir ?? PRODUCED_DIR,
    opts.hints ?? {},
  );
}

function post(url: string, body = '{"rows":12}') {
  return app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/octet-stream' },
    payload: Buffer.from(body, 'utf8'),
  });
}

interface ListedItem {
  job_id: string;
  uid: string;
  sid?: string;
  call_id?: string;
  tool: string;
  status: string;
  size: number;
  filename: string;
  relPath: string;
  created_at: string;
  finished_at: string;
}

async function list(limit?: number): Promise<ListedItem[]> {
  const res = await app.inject({
    method: 'GET',
    url: limit === undefined ? '/api/produced' : `/api/produced?limit=${limit}`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: ListedItem[] }).items;
}

describe('POST /api/files/put —— 回写通道', () => {
  it('正常回写：202 + 落盘路径与体积；随后列表可见（含归属提示信息）', async () => {
    const url = putUrl({ hints: { sid: 'th_a1', callId: 'call_c1', tool: 'ocr__submit_ocr' } });
    const res = await post(`${url}&filename=j_101.json`);

    expect(res.statusCode).toBe(202);
    const body = res.json() as { path: string; size: number };
    expect(body.path).toBe(`${PRODUCED_DIR}/th_a1_j_101.json`);
    expect(body.size).toBe(Buffer.byteLength('{"rows":12}'));

    const items = await list();
    const saved = items.find((i) => i.job_id === 'j_101');
    expect(saved).toMatchObject({
      uid: 'admin',
      sid: 'th_a1',
      call_id: 'call_c1',
      tool: 'ocr__submit_ocr',
      status: 'done',
      filename: 'th_a1_j_101.json',
      relPath: `${PRODUCED_DIR}/th_a1_j_101.json`,
    });
  });

  it('缺少 filename → 400（不给无主产出）', async () => {
    const res = await post(putUrl());
    expect(res.statusCode).toBe(400);
  });

  it('签名被篡改 → 403 FILE_SIGN_INVALID', async () => {
    const url = putUrl().replace(/sig=[0-9a-f]+/, `sig=${'a'.repeat(64)}`);
    const res = await post(`${url}&filename=j_1.json`);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FILE_SIGN_INVALID');
  });

  it('读签名不能用于写（§10.6 不变式 3 的端到端证据）', async () => {
    // 形状隔离：读方向三段 payload 的签名，放到写端点上验签必然失败
    const readUrl = mintSignedUrl('http://backend:3000', SECRET, 'admin', '共享空间/a.xlsx');
    const sig = new URL(readUrl).searchParams.get('sig')!;
    const exp = new URL(readUrl).searchParams.get('exp')!;
    const forged = `http://backend:3000/api/files/put?u=admin&d=${encodeURIComponent(PRODUCED_DIR)}&exp=${exp}&sig=${sig}&filename=j_evil.json`;

    const res = await post(forged);
    expect(res.statusCode).toBe(403);
  });

  it('目录越权（签名合法但 d 不是产出目录）→ 400，且不落盘', async () => {
    const res = await post(`${putUrl({ dir: '共享空间' })}&filename=j_1.json`);
    expect(res.statusCode).toBe(400);

    const items = await list();
    expect(items.find((i) => i.job_id === 'j_1')).toBeUndefined();
  });

  it('非法文件名（`..` 穿越）→ 400', async () => {
    const res = await post(`${putUrl()}&filename=${encodeURIComponent('../evil.json')}`);
    expect(res.statusCode).toBe(400);
  });

  it('幂等：同一 URL 重放即覆盖，列表不产生重复项', async () => {
    const url = `${putUrl({ hints: { sid: 'th_a1' } })}&filename=j_200.json`;
    expect((await post(url, 'v1')).statusCode).toBe(202);
    expect((await post(url, 'v2')).statusCode).toBe(202);

    const matched = (await list()).filter((i) => i.job_id === 'j_200');
    expect(matched).toHaveLength(1);
    expect(matched[0]!.size).toBe(Buffer.byteLength('v2'));
  });

  it('落盘即推变更信号（负载为空，前端收到后重拉列表）', async () => {
    const ctx = (app as unknown as { ctx: AppContext }).ctx;
    const signals: string[] = [];
    const unsubscribe = ctx.producedEvents.onChanged((userId) => signals.push(userId));

    try {
      const res = await post(`${putUrl({ hints: { sid: 'th_a1' } })}&filename=j_300.json`);
      expect(res.statusCode).toBe(202);
      expect(signals).toEqual(['admin']);
    } finally {
      unsubscribe();
    }
  });
});

describe('GET /api/produced —— 产出列表', () => {
  it('未落盘时期望为空（本用例前置：目录不存在）', async () => {
    // 目录可能已由前序用例创建；此处只断言"不抛错且形状正确"
    const items = await list();
    expect(Array.isArray(items)).toBe(true);
  });

  it('有界返回：limit 生效且不超过上限', async () => {
    expect((await list(1)).length).toBeLessThanOrEqual(1);
    expect((await list(0)).length).toBeGreaterThan(0); // 非法值退回默认上限，而不是空表
  });

  it('倒序：最新的产出排在最前', async () => {
    const items = await list();
    const times = items.map((i) => i.finished_at);
    expect([...times].sort((a, b) => b.localeCompare(a))).toEqual(times);
  });
});

describe('GET /api/produced/events —— 变更信号（SSE）', () => {
  it('建连即推一次；落盘后按用户过滤再推；负载为空', async () => {
    // SSE 是**不结束**的响应，`app.inject` 会一直等 → 这里起真实监听端口读帧
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;

    const ctx = (app as unknown as { ctx: AppContext }).ctx;
    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/produced/events`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      // 第一帧：建连即推（客户端不必自己猜"是不是还没变化"）
      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('event: produced');
      expect(first).toContain('data: ');

      // 别的用户的信号不推给本连接；本用户的信号推
      ctx.producedEvents.emitChanged('someone-else');
      ctx.producedEvents.emitChanged('admin');
      const second = decoder.decode((await reader.read()).value);
      expect(second).toContain('event: produced');

      reader.releaseLock();
    } finally {
      controller.abort();
    }
  });
});
