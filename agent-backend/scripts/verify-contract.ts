/**
 * 契约一致性自动核对（手动运行，不进 CI）：
 *
 *   cd agent-backend
 *   npx tsx scripts/verify-contract.ts
 *
 * 做的事：起一个后端（若 :3000 已在跑则直接复用，不重启），按
 * `frontend/specs/001-agent-chat-ui/contracts/backend-api.md` 逐项打真实 HTTP，
 * 打印 PASS/FAIL 表格后退出（FAIL 退出码 1）。
 *
 * **不打 LLM**：只走 agents / models / threads / files 的读写，不发送消息，
 * 因此不消耗 API 额度。依赖 `prepare-integration-data.ts all` 造出的 itest 数据。
 *
 * 覆盖的是「浏览器里打不到」的部分：
 * - 9 个目录白名单、列表接口不接受 limit/offset、实例未创建时 MCP 全 failed
 * - 上传 413、预览 413（前端预校验会拦在本地，UI 走不到）
 * - 历史消息的 id / usage / duration / attachments / error / feedback 原样返回
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const cwd = process.cwd();
const BASE = process.env.VERIFY_BASE_URL ?? 'http://127.0.0.1:3000';
const FIXTURES = 'integration-fixtures';
const MARK = 'itest-';
const THREADS_LIMIT = 50;

interface Result {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Result[] = [];

function check(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
}

function assertBackendRoot(): void {
  if (!fs.existsSync(path.join(cwd, 'config.yaml'))) {
    console.error(`✗ 请在 agent-backend 目录下运行（当前：${cwd}）。`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------ HTTP 小工具 */

async function api(
  method: string,
  route: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${route}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: res.status, json: parseBody(await res.text()) };
}

/** 容错解析响应体：非 JSON 时保留原文片段，便于失败时定位 */
function parseBody(text: string): any {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { __raw: text.slice(0, 200) };
  }
}

async function upload(dir: string, file: string): Promise<{ status: number; json: any }> {
  const form = new FormData();
  form.append('dir', dir);
  // openAsBlob 走流式，避免把 51MB 读进内存
  form.append('file', await fs.openAsBlob(path.join(cwd, file)), path.basename(file));
  const res = await fetch(`${BASE}/api/files/upload`, { method: 'POST', body: form });
  return { status: res.status, json: parseBody(await res.text()) };
}

const codeOf = (json: any): string => String(json?.error?.code ?? '');

/* -------------------------------------------------------------- 起/复用服务 */

async function probe(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/agents`);
    return res.ok;
  } catch {
    return false;
  }
}

function startServer(): ChildProcess {
  // 等价于 npm run dev，但不经 npm/shell（Windows 上更可控）
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', 'src/server.ts'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => {});
  child.stderr?.on('data', () => {});
  return child;
}

async function waitReady(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return false;
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* --------------------------------------------------------------- 核对项 */

async function runChecks(): Promise<void> {
  /* 1. 数字人 */
  const agents = await api('GET', '/api/agents');
  const names: string[] = Array.isArray(agents.json)
    ? agents.json.map((a: any) => a.agent_name)
    : [];
  check(
    'GET /api/agents 返回顶层数组',
    agents.status === 200 && Array.isArray(agents.json),
    `status=${agents.status} names=${JSON.stringify(names)}`,
  );
  check(
    '联调数字人 demo / demo2 均在列表',
    names.includes('demo') && names.includes('demo2'),
    `names=${JSON.stringify(names)}`,
  );

  const detail = await api('GET', '/api/agents/demo');
  const d = detail.json ?? {};
  check(
    'GET /api/agents/demo 结构完整',
    detail.status === 200 &&
      typeof d.soul === 'string' &&
      Array.isArray(d.skills) &&
      Array.isArray(d.enabled_tools) &&
      Array.isArray(d.mcp_servers),
    `status=${detail.status} keys=${JSON.stringify(Object.keys(d))}`,
  );

  // exit → select 顺序（FR-037）
  const exited = await api('POST', '/api/agents/current/exit');
  check(
    'POST /api/agents/current/exit 幂等返回 exited',
    exited.status === 200 && typeof exited.json?.exited === 'boolean',
    `status=${exited.status} body=${JSON.stringify(exited.json)}`,
  );

  const select2 = await api('POST', '/api/agents/demo2/select');
  check(
    'POST /api/agents/demo2/select 成功',
    select2.status === 200 && select2.json?.agent_name === 'demo2',
    `status=${select2.status} body=${JSON.stringify(select2.json)}`,
  );

  const current = await api('GET', '/api/agents/current');
  check(
    'GET /api/agents/current 反映当前选中',
    current.status === 200 && current.json?.agent_name === 'demo2',
    JSON.stringify(current.json),
  );

  // ★ 契约：实例未创建时 MCP 一律 failed（FR-034）
  const mcp = await api('GET', '/api/agents/current/mcp');
  const servers: any[] = Array.isArray(mcp.json?.mcp_servers) ? mcp.json.mcp_servers : [];
  const allFailed = servers.length > 0 && servers.every((s) => s.status === 'failed');
  check(
    '实例未创建 → MCP 全部 failed（FR-034 预期）',
    mcp.status === 200 && mcp.json?.agent_name === 'demo2' && allFailed,
    `servers=${JSON.stringify(servers)}`,
  );

  // ★ 契约：详情不外泄连接细节（仅 name/transport）
  const d2 = await api('GET', '/api/agents/demo2');
  const mcpDetail: any[] = Array.isArray(d2.json?.mcp_servers) ? d2.json.mcp_servers : [];
  const leaks = mcpDetail.some((s) => 'url' in s || 'command' in s || 'args' in s);
  check(
    '数字人详情不外泄 MCP url/command',
    d2.status === 200 && mcpDetail.length === 2 && !leaks,
    `mcp_servers=${JSON.stringify(mcpDetail)}`,
  );

  /* 2. 模型 */
  const models = await api('GET', '/api/models');
  const list: any[] = Array.isArray(models.json?.models) ? models.json.models : [];
  const defaults = list.filter((m) => m.is_default === true);
  check(
    'GET /api/models 正常且默认项唯一',
    models.status === 200 && list.length >= 1 && defaults.length === 1,
    `models=${JSON.stringify(list)}`,
  );

  /* 3. 会话列表 */
  const threads = await api('GET', '/api/threads');
  const rows: any[] = Array.isArray(threads.json) ? threads.json : [];
  const itestRow = rows.find((t) => typeof t.title === 'string' && t.title.startsWith(MARK));
  check(
    'GET /api/threads 返回顶层数组',
    threads.status === 200 && Array.isArray(threads.json),
    `status=${threads.status} count=${rows.length}`,
  );
  check(
    '联调长会话出现在列表中（title 由后端给定）',
    Boolean(itestRow),
    itestRow ? `title=${itestRow.title} id=${itestRow.thread_id}` : '未找到 itest- 前缀会话',
  );

  // ★ 差异 2（联调实测修正）：未声明参数被「静默丢弃」而非报错
  const withIgnoredParam = await api('GET', '/api/threads?limit=10');
  const sameAsPlain = JSON.stringify(withIgnoredParam.json) === JSON.stringify(threads.json);
  check(
    '★ 列表接口传 limit 被静默丢弃而非拒绝（差异 2）',
    withIgnoredParam.status === 200 && sameAsPlain,
    `status=${withIgnoredParam.status} 与不带参响应一致=${sameAsPlain} count=${Array.isArray(withIgnoredParam.json) ? withIgnoredParam.json.length : 'n/a'}`,
  );

  const filtered = await api('GET', '/api/threads?agent_name=demo');
  const allDemo =
    Array.isArray(filtered.json) && filtered.json.every((t: any) => t.agent_name === 'demo');
  check(
    '已声明参数 agent_name 正常生效',
    filtered.status === 200 && allDemo,
    `status=${filtered.status} count=${Array.isArray(filtered.json) ? filtered.json.length : 'n/a'}`,
  );

  /* 4. 会话详情：分页 + 消息字段原样返回 */
  if (itestRow) {
    const tid = itestRow.thread_id as string;
    const p1 = await api('GET', `/api/threads/${tid}?limit=${THREADS_LIMIT}&offset=0`);
    const msgs: any[] = Array.isArray(p1.json?.messages) ? p1.json.messages : [];
    check(
      '详情第一页：total=120 / 本页 50 条',
      p1.status === 200 && p1.json?.total === 120 && msgs.length === THREADS_LIMIT,
      `total=${p1.json?.total} page=${msgs.length} running=${p1.json?.running}`,
    );

    const byId = new Map(msgs.map((m) => [m.id, m]));
    const withUsage: any = byId.get(`${MARK}msg-117`);
    check(
      '★ 带 usage 的消息含 duration_seconds（精度可多于 1 位）',
      Boolean(
        withUsage?.usage?.input_tokens === 1234 && typeof withUsage?.duration_seconds === 'number',
      ),
      withUsage
        ? `usage=${JSON.stringify(withUsage.usage)} duration_seconds=${withUsage.duration_seconds}`
        : '未找到 itest-msg-117',
    );

    const withAtt: any = byId.get(`${MARK}msg-118`);
    check(
      '★ 带 @ 引用的 user 消息含 attachments',
      Array.isArray(withAtt?.attachments) && withAtt.attachments[0]?.dir === '生产计划',
      withAtt ? `attachments=${JSON.stringify(withAtt.attachments)}` : '未找到 itest-msg-118',
    );

    const failed: any = byId.get(`${MARK}msg-119`);
    check(
      '★ 失败轮返回 status=failed + error.code',
      failed?.status === 'failed' && typeof failed?.error?.code === 'string',
      failed
        ? `status=${failed.status} code=${failed?.error?.code} contentLen=${String(failed.content ?? '').length}`
        : '未找到 itest-msg-119',
    );

    const liked: any = byId.get(`${MARK}msg-120`);
    check(
      '★ 反馈行合并为 feedback=up',
      liked?.feedback === 'up',
      liked ? `feedback=${liked.feedback}` : '未找到 itest-msg-120',
    );

    const anyThinking = msgs.some((m) => 'thinking' in m || 'tool_calls' in m || 'toolCalls' in m);
    check(
      '★ 消息不含思考/工具字段（FR-009）',
      !anyThinking,
      anyThinking ? '发现思考/工具字段' : 'ok',
    );

    const p2 = await api(
      'GET',
      `/api/threads/${tid}?limit=${THREADS_LIMIT}&offset=${THREADS_LIMIT}`,
    );
    const page2: any[] = Array.isArray(p2.json?.messages) ? p2.json.messages : [];
    const overlap = page2.some((m) => byId.has(m.id));
    check(
      '★ offset=50 取到更早一页且不与首页重叠',
      p2.status === 200 && page2.length === THREADS_LIMIT && !overlap,
      `page2=${page2.length} overlap=${overlap} 首条=${page2[0]?.id}`,
    );

    const outOfRange = await api('GET', `/api/threads/${tid}?limit=999`);
    check(
      '详情 limit=999 → 400（证明 schema 校验确实生效）',
      outOfRange.status === 400,
      `status=${outOfRange.status} code=${codeOf(outOfRange.json)}`,
    );

    const missing = await api('GET', `/api/threads/${MARK}not-a-thread`);
    check(
      '未知会话 → 404 THREAD_NOT_FOUND',
      missing.status === 404 && codeOf(missing.json) === 'THREAD_NOT_FOUND',
      `status=${missing.status} code=${codeOf(missing.json)}`,
    );
  }

  /* 5. 文件与空间目录 */
  const ws = await api('GET', '/api/files/workspace');
  const dirs: any[] = Array.isArray(ws.json?.dirs) ? ws.json.dirs : [];
  check(
    '★ GET /api/files/workspace 恰好 9 个目录（差异 1）',
    ws.status === 200 && dirs.length === 9,
    `count=${dirs.length} dirs=${JSON.stringify(dirs.map((x) => x.dir))}`,
  );

  const plan = dirs.find((x) => x.dir === '生产计划');
  const planFiles: any[] = Array.isArray(plan?.files) ? plan.files : [];
  check(
    '联调样本文件出现在 workspace 清单',
    planFiles.some((f) => String(f.filename).startsWith(MARK)),
    `files=${JSON.stringify(planFiles.map((f) => f.filename))}`,
  );

  const listPlan = await api('GET', `/api/files/list?dir=${encodeURIComponent('生产计划')}`);
  check(
    'GET /api/files/list 支持中文目录',
    listPlan.status === 200 && Array.isArray(listPlan.json) && listPlan.json.length >= 1,
    `status=${listPlan.status} count=${Array.isArray(listPlan.json) ? listPlan.json.length : 'n/a'}`,
  );

  const forbidden = await api('GET', `/api/files/list?dir=${encodeURIComponent('不存在的目录')}`);
  check(
    '非白名单目录 → 403 UPLOAD_DIR_FORBIDDEN',
    forbidden.status === 403 && codeOf(forbidden.json) === 'UPLOAD_DIR_FORBIDDEN',
    `status=${forbidden.status} code=${codeOf(forbidden.json)}`,
  );

  /* 6. 上传 413 与预览 413（UI 打不到，必须绕过前端预校验） */
  const bigUpload = await upload('tmp', path.join(FIXTURES, `${MARK}toobig-51mb.txt`));
  check(
    '★ 上传 >50MB → 413 FILE_TOO_LARGE',
    bigUpload.status === 413 && codeOf(bigUpload.json) === 'FILE_TOO_LARGE',
    `status=${bigUpload.status} code=${codeOf(bigUpload.json)}`,
  );

  const okUpload = await upload('tmp', path.join(FIXTURES, `${MARK}small.pdf`));
  check(
    '上传 small.pdf → 201 并返回落盘名',
    okUpload.status === 201 && typeof okUpload.json?.filename === 'string',
    `status=${okUpload.status} body=${JSON.stringify(okUpload.json)}`,
  );

  if (typeof okUpload.json?.filename === 'string') {
    const saved = okUpload.json.filename as string;
    const preview = await fetch(
      `${BASE}/api/files/preview?dir=tmp&filename=${encodeURIComponent(saved)}`,
    );
    check(
      '预览 PDF → 200 且 Content-Type 为 application/pdf',
      preview.status === 200,
      `status=${preview.status} type=${preview.headers.get('content-type')}`,
    );
    const download = await fetch(
      `${BASE}/api/files/download?dir=tmp&filename=${encodeURIComponent(saved)}`,
    );
    check(
      '下载 → 200 且为 attachment',
      download.status === 200 &&
        String(download.headers.get('content-disposition')).includes('attachment'),
      `status=${download.status} disp=${download.headers.get('content-disposition')}`,
    );
  }

  const bigPreview = await upload('tmp', path.join(FIXTURES, `${MARK}preview-toobig.pdf`));
  if (bigPreview.status === 201 && typeof bigPreview.json?.filename === 'string') {
    const saved = bigPreview.json.filename as string;
    const res = await fetch(
      `${BASE}/api/files/preview?dir=tmp&filename=${encodeURIComponent(saved)}`,
    );
    check(
      '★ 预览 >10MB → 413 FILE_TOO_LARGE（FR-048）',
      res.status === 413,
      `status=${res.status}`,
    );
  } else {
    check(
      '★ 预览 >10MB → 413 FILE_TOO_LARGE（FR-048）',
      false,
      `前置上传失败：status=${bigPreview.status} ${JSON.stringify(bigPreview.json)}`,
    );
  }

  /* 收尾：把选中态恢复为 demo，便于手工联调 */
  await api('POST', '/api/agents/current/exit');
  await api('POST', '/api/agents/demo/select');
}

/* ------------------------------------------------------------------ 入口 */

assertBackendRoot();

let child: ChildProcess | null = null;
const alreadyRunning = await probe();
if (alreadyRunning) {
  console.log(`复用已在运行的后端：${BASE}`);
} else {
  console.log(`启动后端（node --env-file=.env --import tsx src/server.ts）…`);
  child = startServer();
  const ready = await waitReady(child, 30_000);
  if (!ready) {
    console.error('✗ 后端未能在 30s 内就绪，请手动运行 npm run dev 看报错。');
    child.kill();
    process.exit(1);
  }
  console.log(`后端已就绪：${BASE}`);
}

try {
  await runChecks();
} catch (err) {
  check('核对过程异常', false, err instanceof Error ? err.message : String(err));
} finally {
  if (child) {
    child.kill();
    await new Promise((r) => setTimeout(r, 500));
  }
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n=== 契约核对结果（${pass}/${results.length} 通过）===`);
for (const r of results) {
  console.log(`${r.ok ? '✅' : '❌'} ${r.name}`);
  if (!r.ok || process.argv.includes('--verbose')) console.log(`     ${r.detail}`);
}
if (pass !== results.length) {
  console.error('\n存在不一致：前端契约或后端实现需要核对（见上表 detail）。');
  process.exit(1);
}
console.log(
  '\n✅ 全部通过：后端实现与 frontend/specs/001-agent-chat-ui/contracts/backend-api.md 一致',
);
