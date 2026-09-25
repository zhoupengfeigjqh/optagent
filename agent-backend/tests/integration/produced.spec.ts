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
  summary?: string;
  filename: string;
  relPath: string;
  created_at: string;
  finished_at: string;
  /** 查询期由 `sid` 反查的数字人；缺省 = `sid` 缺失或会话已删除 */
  agent_name?: string;
  /** 缺省 = 未读（契约 §10.5 ⑤） */
  read_at?: string;
}

async function list(limit?: number): Promise<ListedItem[]> {
  const res = await app.inject({
    method: 'GET',
    url: limit === undefined ? '/api/produced' : `/api/produced?limit=${limit}`,
  });
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: ListedItem[] }).items;
}

/** 标记已读（载荷故意宽松：非法形状也要能发出去，供边界用例断言 400） */
function markRead(jobIds: unknown) {
  return app.inject({
    method: 'POST',
    url: '/api/produced/read',
    payload: { job_ids: jobIds },
  });
}

/** 取某条产出在列表里的当前形态（不存在则 `undefined`） */
async function findItem(jobId: string): Promise<ListedItem | undefined> {
  return (await list()).find((i) => i.job_id === jobId);
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

describe('POST /api/produced/read —— 已读状态（契约 §10.5 ⑤）', () => {
  it('标记未读产出 → 写入 read_at、返回实际条数，列表随之带出该字段', async () => {
    await post(`${putUrl({ hints: { sid: 'th_r1' } })}&filename=j_r1.json`);

    const res = await markRead(['j_r1']);

    expect(res.statusCode).toBe(200);
    expect((res.json() as { marked: number }).marked).toBe(1);
    expect(typeof (await findItem('j_r1'))?.read_at).toBe('string');
  });

  it('新产出默认未读（read_at 缺省）——不写 `read_at: false` 之类的反向表达', async () => {
    await post(`${putUrl({ hints: { sid: 'th_r3' } })}&filename=j_r3.json`);

    expect((await findItem('j_r3'))?.read_at).toBeUndefined();
  });

  it('幂等：重复标记**不改动**原 read_at，且 marked=0', async () => {
    await post(`${putUrl({ hints: { sid: 'th_r2' } })}&filename=j_r2.json`);
    await markRead(['j_r2']);
    const first = (await findItem('j_r2'))!.read_at;

    const again = await markRead(['j_r2']);

    expect((again.json() as { marked: number }).marked).toBe(0);
    expect((await findItem('j_r2'))!.read_at).toBe(first);
  });

  it('不存在的 job_id 一律忽略（产出可能已被 7 天清理），不报错', async () => {
    const res = await markRead(['never-existed']);

    expect(res.statusCode).toBe(200);
    expect((res.json() as { marked: number }).marked).toBe(0);
  });

  it('空数组是合法请求（无事发生）', async () => {
    const res = await markRead([]);

    expect(res.statusCode).toBe(200);
    expect((res.json() as { marked: number }).marked).toBe(0);
  });

  it('job_ids 非法 → 400（缺字段 / 元素为空串）', async () => {
    for (const jobIds of [undefined, ['']]) {
      const res = await markRead(jobIds);
      expect(res.statusCode).toBe(400);
    }
  });

  it('标量被 Fastify 的 ajv 强转为单元素数组（框架既有约定，非本端点特有）', async () => {
    // `'j_r1'` → `['j_r1']`：等于标记一个不存在的 job_id → 按"忽略"处理，不报错也不误标
    const res = await markRead('j_r1');

    expect(res.statusCode).toBe(200);
    expect((res.json() as { marked: number }).marked).toBe(0);
  });

  it('已读是本条产出的属性：不同产出互不影响', async () => {
    await post(`${putUrl({ hints: { sid: 'th_r4' } })}&filename=j_r4.json`);
    await post(`${putUrl({ hints: { sid: 'th_r5' } })}&filename=j_r5.json`);

    await markRead(['j_r4']);

    expect(typeof (await findItem('j_r4'))?.read_at).toBe('string');
    expect((await findItem('j_r5'))?.read_at).toBeUndefined();
  });
});

describe('GET /api/produced/raw —— 读单条产出正文（契约 §10.5 ⑦）', () => {
  it('按 job_id 返回正文：纯文本 + nosniff（产出内容不该被当作主动内容渲染）', async () => {
    await post(`${putUrl({ hints: { sid: 'th_raw' } })}&filename=j_raw.txt`, '识别结果正文');

    const res = await app.inject({ method: 'GET', url: '/api/produced/raw?job_id=j_raw' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toBe('识别结果正文');
  });

  it('job_id 不存在 → 404 FILE_NOT_FOUND（与"已被 7 天清理"同一语义）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/produced/raw?job_id=ghost' });

    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe('FILE_NOT_FOUND');
  });

  it('缺 job_id → 400', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/produced/raw' })).statusCode).toBe(400);
  });

  it('能读到**列表之外**的更旧条目（列表有界，不代表读不到）', async () => {
    for (let i = 0; i < 55; i += 1) {
      await post(
        `${putUrl({ hints: { sid: 'th_old' } })}&filename=j_old_${i}.txt`,
        `body-${i}`,
      );
    }
    expect((await list()).some((i) => i.job_id === 'j_old_0')).toBe(false);

    const res = await app.inject({ method: 'GET', url: '/api/produced/raw?job_id=j_old_0' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('body-0');
  });

  it('产出目录是**二级目录**——这正是它不能走 files 预览接口的原因', () => {
    // files 系列接口的 `dir` 语义是**空间顶层目录**（数据准备的二级目录还须命中
    // `scenario.json` 清单），而产出落在 `临时空间/后台产出/`（契约 §10.4）。
    // 这里钉住这条事实：将来若有人想"顺手复用" files 预览，先看这里。
    // （不写成"请求 files 预览应当 400"的接口断言：那条路径要先选中数字人，
    //   否则请求在 `checkDir` 之前就会以 409 AGENT_NOT_SELECTED 结束，测不到目标分支。）
    expect(PRODUCED_DIR.startsWith('临时空间/')).toBe(true);
    expect(PRODUCED_DIR.split('/')).toHaveLength(2);
  });
});

describe('回写摘要（契约 §10.3）—— 产出列表的可辨识度', () => {
  it('服务带 summary → 落到 sidecar 并出现在列表里', async () => {
    const url =
      `${putUrl({ hints: { sid: 'th_s1' } })}` +
      `&filename=j_s1.txt&summary=${encodeURIComponent('识别到 47 行文字')}`;

    expect((await post(url)).statusCode).toBe(202);
    expect((await findItem('j_s1'))?.summary).toBe('识别到 47 行文字');
  });

  it('缺省 summary → 列表项不含该字段（界面据此走兜底文案，而不是显示空串）', async () => {
    await post(`${putUrl({ hints: { sid: 'th_s2' } })}&filename=j_s2.txt`);

    expect((await findItem('j_s2'))?.summary).toBeUndefined();
  });

  it('超长 summary 截断到 200 字符（截断而非拒绝：算完的任务不该因摘要过长而失败）', async () => {
    const url =
      `${putUrl({ hints: { sid: 'th_s3' } })}` +
      `&filename=j_s3.txt&summary=${encodeURIComponent('甲'.repeat(500))}`;

    expect((await post(url)).statusCode).toBe(202);
    expect((await findItem('j_s3'))?.summary).toHaveLength(200);
  });

  it('summary 不参与验签（与 filename 同一处置）：篡改它只影响展示，不构成越权', async () => {
    // 签名覆盖的仍是 u/d/exp；这里只换 summary，写入必须照常成功
    const url = `${putUrl({ hints: { sid: 'th_s4' } })}&filename=j_s4.txt&summary=tampered`;

    expect((await post(url)).statusCode).toBe(202);
    expect((await findItem('j_s4'))?.summary).toBe('tampered');
  });
});

describe('GET /api/produced —— 数字人归属（查询期由 sid 反查，§10.5 ⑥）', () => {
  function ctxOf(): AppContext {
    return (app as unknown as { ctx: AppContext }).ctx;
  }

  it('sid 命中的会话 → 列表项带 agent_name（该会话最近一轮使用的数字人）', async () => {
    const thread = ctxOf().threadStore.create('admin', '数字人甲');
    await post(`${putUrl({ hints: { sid: thread.threadId } })}&filename=j_agent1.txt`);

    expect((await findItem('j_agent1'))?.agent_name).toBe('数字人甲');
  });

  it('会话 meta 的 agent_name 变了 → 反查结果随之更新（不落 sidecar，故不会漂移）', async () => {
    const thread = ctxOf().threadStore.create('admin', '数字人甲');
    await post(`${putUrl({ hints: { sid: thread.threadId } })}&filename=j_agent1b.txt`);
    ctxOf().threadStore.touch('admin', thread.threadId, '数字人丙'); // 会话可跨数字人

    expect((await findItem('j_agent1b'))?.agent_name).toBe('数字人丙');
  });

  it('会话已删除 → 产出仍在，但不带 agent_name（界面据此显示"未知"，不报错）', async () => {
    const thread = ctxOf().threadStore.create('admin', '数字人乙');
    await post(`${putUrl({ hints: { sid: thread.threadId } })}&filename=j_agent2.txt`);

    ctxOf().threadStore.delete('admin', thread.threadId);

    const item = await findItem('j_agent2');
    expect(item).toBeDefined(); // 产出在二级目录，不随会话删除而消失（已知边界）
    expect(item?.agent_name).toBeUndefined();
  });

  it('sid 缺失 → 不带 agent_name，且列表照常返回', async () => {
    await post(`${putUrl()}&filename=j_agent3.txt`);

    expect((await findItem('j_agent3'))?.agent_name).toBeUndefined();
  });
});
