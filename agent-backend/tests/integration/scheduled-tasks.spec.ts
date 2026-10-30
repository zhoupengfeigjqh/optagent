/**
 * 集成测试：定时任务 7 个端点（015，契约 `contracts/scheduled-tasks-api.md`）。
 *
 * 覆盖：
 * - `GET`：空数组、派生字段现算（`status`/`terminated`/`can_start`）、`created_at` 倒序、
 *   内部字段 `reused_thread_id` 不下发；
 * - `POST`：201 形状、会话模式缺省 `true`、7 项非法输入 → 400（`details` 带字段名）、
 *   重复名称 → 409；
 * - `PATCH :id`（2026-10-30 增补）：整份替换 7 项可编辑字段、`next_run_at` 重置、
 *   启用中 409、重名 409、不存在 404、带 `new_thread_per_run` → 400；
 * - `PATCH enabled`：启用把过去的计划时刻推进到未来、幂等、次数用尽 → 409、不存在 → 404；
 * - `DELETE`：启用中 409、停用后 204、列表消失、其运行记录不再出现（`FR-022`）；
 * - `GET runs`：空态、倒序、`task_id` 筛选、`limit` 上限、`thread_deleted` 回填；
 * - `GET events`：建连即推 `scheduled-task` 帧、本用户信号再推一帧；
 * - 隔离（`FR-053`）：他人 uid 的任务在列表不可见，按 id 操作一律 404。
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
import { agentDir } from '../../src/domain/dirs.js';
import type { CreateScheduledTaskInput } from '../../src/domain/scheduled-task-store.js';
import { buildServer } from '../../src/server';

const USER = 'admin';
const AGENT = 'demo';
const root = mkdtempSync(path.join(tmpdir(), 'optagent-scheduled-'));
let app: FastifyInstance;

function ctxOf(): AppContext {
  return (app as unknown as { ctx: AppContext }).ctx;
}

function writeAgent(name: string): void {
  const dir = agentDir(root, USER, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SOUL.md'), '你是助手。\n', 'utf8');
  writeFileSync(path.join(dir, 'TOOL.json'), JSON.stringify({ enabled: [] }), 'utf8');
  writeFileSync(path.join(dir, 'MCP.json'), JSON.stringify({ servers: [] }), 'utf8');
}

/** 相对当前时刻的 ISO（正数 = 未来） */
function at(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

/** 合法创建体（各用例按需覆写某几项） */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: `任务-${Math.random().toString(36).slice(2, 8)}`,
    prompt: '汇总今天的进度',
    start_at: at(60),
    interval_seconds: 3600,
    max_runs: 3,
    deadline_at: at(86_400),
    ...overrides,
  };
}

function create(body: unknown = draft()) {
  return app.inject({ method: 'POST', url: '/api/scheduled-tasks', payload: body as object });
}

function list() {
  return app.inject({ method: 'GET', url: '/api/scheduled-tasks' });
}

function setEnabled(id: string, enabled: boolean) {
  return app.inject({
    method: 'PATCH',
    url: `/api/scheduled-tasks/${id}/enabled`,
    payload: { enabled },
  });
}

function remove(id: string) {
  return app.inject({ method: 'DELETE', url: `/api/scheduled-tasks/${id}` });
}

function listRuns(query = '') {
  return app.inject({ method: 'GET', url: `/api/scheduled-tasks/runs${query}` });
}

/** 直接写存储（用于构造"创建时刻不同""次数用尽"这类状态，避免依赖真实时钟精度） */
function seedTask(input: Partial<CreateScheduledTaskInput> = {}, createdAt?: Date) {
  const full: CreateScheduledTaskInput = {
    name: `种子-${Math.random().toString(36).slice(2, 8)}`,
    prompt: '种子提示词',
    thinking: false,
    startAt: at(-3600),
    intervalSeconds: 3600,
    maxRuns: 3,
    deadlineAt: at(86_400),
    newThreadPerRun: true,
    ...input,
  };
  return ctxOf().scheduled.store.create(USER, AGENT, full, createdAt);
}

type TaskJson = {
  task_id: string;
  name: string;
  enabled: boolean;
  executed_count: number;
  status: string;
  terminated: boolean;
  can_start: boolean;
  disabled_reason: string | null;
  next_run_at: string | null;
  new_thread_per_run: boolean;
  start_at: string;
};

beforeAll(async () => {
  mkdirSync(path.join(root, 'users', USER), { recursive: true });
  writeAgent(AGENT);
  writeAgent('other-agent');
  const configPath = path.join(root, 'config.yaml');
  writeFileSync(configPath, 'models:\n  - model: test-model\n    api_key: test-key\n', 'utf8');
  const config = loadConfig({
    env: { PUBLIC_BASE_URL: 'http://backend:3000', OPT_AGENT_ROOT: root },
    configPath,
  });
  app = await buildServer({ config });
  ctxOf().currentAgent.select(USER, AGENT);
});

afterAll(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/scheduled-tasks', () => {
  it('无任务 → 200 + 空数组（空态不是错误）', async () => {
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tasks: [] });
  });

  it('派生字段现算 + 内部字段不下发 + created_at 倒序', async () => {
    const older = seedTask({ name: '较早的任务', newThreadPerRun: false }, new Date('2026-10-01T00:00:00Z'));
    seedTask({ name: '较晚的任务' }, new Date('2026-10-02T00:00:00Z'));

    const res = await list();
    const tasks = res.json().tasks as TaskJson[];

    expect(tasks.map((t) => t.name).slice(0, 2)).toEqual(['较晚的任务', older.name]);
    const first = tasks[0]!;
    expect(first).toMatchObject({
      enabled: false,
      executed_count: 0,
      status: 'idle',
      terminated: false,
      can_start: true,
      disabled_reason: null,
      new_thread_per_run: true,
    });
    expect('reused_thread_id' in first).toBe(false);
    // 复用模式任务回显 false（且同样不下发内部字段）
    const reuse = tasks.find((t) => t.task_id === older.taskId)!;
    expect(reuse.new_thread_per_run).toBe(false);
    expect('reused_thread_id' in reuse).toBe(false);
  });
});

describe('POST /api/scheduled-tasks', () => {
  it('201：不自动启用，next_run_at = start_at，会话模式缺省 true', async () => {
    const body = draft();
    const res = await create(body);

    expect(res.statusCode).toBe(201);
    const task = res.json().task as TaskJson;
    expect(task).toMatchObject({
      name: body.name,
      enabled: false,
      executed_count: 0,
      status: 'idle',
      can_start: true,
      new_thread_per_run: true,
    });
    expect(task.start_at).toBe(new Date(body.start_at).toISOString());
    expect(task.next_run_at).toBe(task.start_at);
  });

  it('带 new_thread_per_run=false → 回显 false', async () => {
    const res = await create(draft({ new_thread_per_run: false }));
    expect(res.json().task.new_thread_per_run).toBe(false);
  });

  it.each([
    ['空名称', { name: '   ' }, 'name'],
    ['空提示词', { prompt: '   ' }, 'prompt'],
    ['开始时间在过去', { start_at: at(-60) }, 'start_at'],
    ['截止不晚于开始', { deadline_at: at(30) }, 'deadline_at'],
    ['间隔小于 1', { interval_seconds: 0 }, 'interval_seconds'],
    ['次数小于 1', { max_runs: 0 }, 'max_runs'],
    ['非法日期', { start_at: '不是时间' }, 'start_at'],
  ])('%s → 400 VALIDATION_FAILED（details 指出字段）', async (_label, override, field) => {
    const res = await create(draft(override));

    expect(res.statusCode).toBe(400);
    const error = res.json().error as { code: string; message: string; details?: string[] };
    expect(error.code).toBe('VALIDATION_FAILED');
    if (field === 'interval_seconds' || field === 'max_runs') {
      // schema 先拦（type/minimum），不经过 details
      expect(typeof error.message).toBe('string');
    } else {
      expect(error.details?.some((item) => item.startsWith(`${field}:`))).toBe(true);
    }
  });

  it('不支持的字段 → 400（additionalProperties: false）', async () => {
    const res = await create({ ...draft(), unexpected: 1 });
    expect(res.statusCode).toBe(400);
  });

  it('同数字人下重名 → 409 SCHEDULED_TASK_NAME_CONFLICT', async () => {
    const body = draft({ name: '重名任务' });
    expect((await create(body)).statusCode).toBe(201);

    const res = await create(draft({ name: '重名任务' }));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEDULED_TASK_NAME_CONFLICT');
  });
});

describe('PATCH /api/scheduled-tasks/:id（编辑，2026-10-30 增补）', () => {
  /** 合法编辑体（7 项可编辑字段，**不含**会话模式） */
  function editDraft(overrides: Record<string, unknown> = {}) {
    return {
      name: `改名-${Math.random().toString(36).slice(2, 8)}`,
      prompt: '新的提示词',
      thinking: true,
      start_at: at(120),
      interval_seconds: 120,
      max_runs: 5,
      deadline_at: at(7_200),
      ...overrides,
    };
  }

  function update(id: string, body: unknown) {
    return app.inject({ method: 'PATCH', url: `/api/scheduled-tasks/${id}`, payload: body as object });
  }

  it('200：整份替换可编辑字段，next_run_at 重置为新的开始时刻，且仍保持停用', async () => {
    const task = seedTask({ name: '待编辑任务' });
    // 已有一次执行：编辑 MUST NOT 追溯改写已执行次数
    ctxOf().scheduled.store.markTriggered(USER, AGENT, task.taskId, { triggeredAt: at(-60) });

    const body = editDraft({ name: '改名后的任务' });
    const res = await update(task.taskId, body);

    expect(res.statusCode).toBe(200);
    const updated = res.json().task as TaskJson & {
      prompt: string;
      thinking: boolean;
      interval_seconds: number;
      max_runs: number;
      executed_count: number;
    };
    expect(updated).toMatchObject({
      name: '改名后的任务',
      prompt: '新的提示词',
      thinking: true,
      interval_seconds: 120,
      max_runs: 5,
      enabled: false,
      executed_count: 1,
    });
    expect(updated.start_at).toBe(new Date(body.start_at).toISOString());
    expect(updated.next_run_at).toBe(updated.start_at);
  });

  it('允许保留已过去的开始时刻（只改名字不会被"开始时间已过"挡住）', async () => {
    const task = seedTask(); // 开始时刻在 1 小时前
    const res = await update(
      task.taskId,
      editDraft({ name: '仅改名', start_at: task.startAt, deadline_at: at(86_400) }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.json().task.start_at).toBe(task.startAt);
  });

  it('启用中 → 409 SCHEDULED_TASK_ENABLED（先停再改）', async () => {
    const task = seedTask();
    await setEnabled(task.taskId, true);

    const res = await update(task.taskId, editDraft());

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEDULED_TASK_ENABLED');
    await setEnabled(task.taskId, false);
  });

  it('同域重名 → 409 SCHEDULED_TASK_NAME_CONFLICT；不存在 → 404', async () => {
    expect((await create(draft({ name: '占位任务' }))).statusCode).toBe(201);
    const target = seedTask({ name: '原名' });

    const conflict = await update(target.taskId, editDraft({ name: '占位任务' }));
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('SCHEDULED_TASK_NAME_CONFLICT');

    const missing = await update('ghost-task', editDraft());
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('SCHEDULED_TASK_NOT_FOUND');
  });

  it('带 new_thread_per_run → 400（会话模式创建后不可改，FR-060）', async () => {
    const task = seedTask();

    const res = await update(task.taskId, { ...editDraft(), new_thread_per_run: false });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });

  it.each([
    ['空名称', { name: '   ' }, 'name'],
    ['空提示词', { prompt: '   ' }, 'prompt'],
    ['截止不晚于开始', { deadline_at: at(30) }, 'deadline_at'],
    ['非法日期', { start_at: '不是时间' }, 'start_at'],
  ])('%s → 400 VALIDATION_FAILED（details 指出字段）', async (_label, override, field) => {
    const task = seedTask();

    const res = await update(task.taskId, editDraft(override));

    expect(res.statusCode).toBe(400);
    const error = res.json().error as { code: string; details?: string[] };
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.details?.some((item) => item.startsWith(`${field}:`))).toBe(true);
  });
});

describe('PATCH /api/scheduled-tasks/:id/enabled', () => {
  it('启用：把落在过去的计划时刻推进到未来（不补跑），状态转为 running', async () => {
    const task = seedTask({ startAt: at(-7200) });

    const res = await setEnabled(task.taskId, true);

    expect(res.statusCode).toBe(200);
    const updated = res.json().task as TaskJson;
    expect(updated.enabled).toBe(true);
    expect(updated.status).toBe('running');
    expect(Date.parse(updated.next_run_at!)).toBeGreaterThan(Date.now());
    // 用完即停用：避免心跳在本文件后续用例里真的去派发
    await setEnabled(task.taskId, false);
  });

  it('重复启用 / 重复停用幂等（返回当前状态）', async () => {
    const task = seedTask();

    expect((await setEnabled(task.taskId, false)).json().task.enabled).toBe(false);
    expect((await setEnabled(task.taskId, false)).json().task.enabled).toBe(false);
  });

  it('次数用尽 → 409 SCHEDULED_TASK_EXHAUSTED', async () => {
    const task = seedTask({ maxRuns: 1 });
    ctxOf().scheduled.store.markTriggered(USER, AGENT, task.taskId, { triggeredAt: at(0) });

    const res = await setEnabled(task.taskId, true);

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SCHEDULED_TASK_EXHAUSTED');
  });

  it('任务不存在 → 404 SCHEDULED_TASK_NOT_FOUND', async () => {
    const res = await setEnabled('ghost-task', true);
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('SCHEDULED_TASK_NOT_FOUND');
  });

  it('创建后不接受 new_thread_per_run（会话模式不可改，FR-060）→ 400', async () => {
    const task = seedTask();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/scheduled-tasks/${task.taskId}/enabled`,
      payload: { enabled: true, new_thread_per_run: false },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('DELETE /api/scheduled-tasks/:id', () => {
  it('启用中 → 409；停用后 → 204，列表消失且运行记录不再出现（FR-022）', async () => {
    const task = seedTask({ name: '待删除任务' });
    ctxOf().scheduled.runs.append(USER, AGENT, {
      taskId: task.taskId,
      taskName: task.name,
      agentName: AGENT,
      triggeredAt: at(-120),
      finishedAt: at(-120),
      result: 'success',
      reason: null,
      reasonText: null,
      threadId: null,
      threadTitle: null,
      rebuilt: false,
    });
    await setEnabled(task.taskId, true);

    const rejected = await remove(task.taskId);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe('SCHEDULED_TASK_ENABLED');

    await setEnabled(task.taskId, false);
    const deleted = await remove(task.taskId);
    expect(deleted.statusCode).toBe(204);

    const tasks = (await list()).json().tasks as TaskJson[];
    expect(tasks.some((t) => t.task_id === task.taskId)).toBe(false);

    const runs = (await listRuns()).json().runs as Array<{ task_id: string }>;
    expect(runs.some((run) => run.task_id === task.taskId)).toBe(false);
  });

  it('任务不存在 → 404', async () => {
    const res = await remove('ghost-task');
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /api/scheduled-tasks/runs', () => {
  it('无记录 → 200 + {runs: [], total: 0}', async () => {
    const res = await listRuns();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ runs: [], total: 0 });
  });

  it('倒序 + 按 task_id 筛选 + thread_deleted 回填', async () => {
    const task = seedTask({ name: '有记录的任务' });
    const alive = ctxOf().threadStore.create(USER, AGENT, { title: '在的会话' });
    const gone = ctxOf().threadStore.create(USER, AGENT, { title: '要删的会话' });
    await ctxOf().threadStore.delete(USER, AGENT, gone.threadId);

    const append = (triggeredAt: string, threadId: string | null, threadTitle: string | null) =>
      ctxOf().scheduled.runs.append(USER, AGENT, {
        taskId: task.taskId,
        taskName: task.name,
        agentName: AGENT,
        triggeredAt,
        finishedAt: triggeredAt,
        result: 'success',
        reason: null,
        reasonText: null,
        threadId,
        threadTitle,
        rebuilt: false,
      });
    append(at(-300), alive.threadId, '在的会话');
    append(at(-120), gone.threadId, '要删的会话');

    const all = (await listRuns(`?task_id=${task.taskId}`)).json();
    expect(all.total).toBe(2);
    const ordered = all.runs as Array<{ triggered_at: string; thread_deleted: boolean }>;
    // 倒序：晚触发的在前
    expect(Date.parse(ordered[0]!.triggered_at)).toBeGreaterThan(
      Date.parse(ordered[1]!.triggered_at),
    );
    expect(ordered[0]!.thread_deleted).toBe(true); // 会话已删 → 不可跳转
    expect(ordered[1]!.thread_deleted).toBe(false);

    // 别的任务筛选不到它
    const other = (await listRuns('?task_id=ghost-task')).json();
    expect(other.total).toBe(0);
  });

  it('复用记录回显 rebuilt=true（重建会话标注，Phase 6）', async () => {
    const task = seedTask({ name: '复用任务', newThreadPerRun: false });
    ctxOf().scheduled.runs.append(USER, AGENT, {
      taskId: task.taskId,
      taskName: task.name,
      agentName: AGENT,
      triggeredAt: at(-60),
      finishedAt: at(-55),
      result: 'success',
      reason: null,
      reasonText: null,
      threadId: null,
      threadTitle: null,
      rebuilt: true,
    });

    const res = (await listRuns(`?task_id=${task.taskId}`)).json();
    expect(res.runs[0].rebuilt).toBe(true);
  });

  it('limit 超上限被夹到 200（不报错）；非数字直接 400', async () => {
    expect((await listRuns('?limit=9999')).statusCode).toBe(200);
    expect((await listRuns('?limit=abc')).statusCode).toBe(400);
  });
});

describe('GET /api/scheduled-tasks/events —— 变更信号（SSE）', () => {
  it('建连即推 scheduled-task 帧；本用户信号再推一帧', async () => {
    // SSE 是**不结束**的响应，`app.inject` 会一直等 → 起真实监听端口读帧
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const controller = new AbortController();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/scheduled-tasks/events`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();

      const first = decoder.decode((await reader.read()).value);
      expect(first).toContain('event: scheduled-task');
      expect(first).toContain('data: ');

      ctxOf().scheduled.events.emitChanged(USER);
      const second = decoder.decode((await reader.read()).value);
      expect(second).toContain('event: scheduled-task');

      reader.releaseLock();
    } finally {
      controller.abort();
    }
  });
});

describe('隔离（FR-053）', () => {
  it('他人 uid 的任务不在列表里，按 id 操作一律 404', async () => {
    const foreign = ctxOf().scheduled.store.create('someone-else', AGENT, {
      name: '别人的任务',
      prompt: 'x',
      thinking: false,
      startAt: at(60),
      intervalSeconds: 3600,
      maxRuns: 1,
      deadlineAt: at(86_400),
      newThreadPerRun: true,
    });

    const tasks = (await list()).json().tasks as TaskJson[];
    expect(tasks.some((t) => t.task_id === foreign.taskId)).toBe(false);
    expect((await setEnabled(foreign.taskId, true)).statusCode).toBe(404);
    expect((await remove(foreign.taskId)).statusCode).toBe(404);
  });

  it('未选中数字人 → 409 AGENT_NOT_SELECTED（选回后恢复）', async () => {
    ctxOf().currentAgent.exit(USER);

    const res = await list();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AGENT_NOT_SELECTED');

    ctxOf().currentAgent.select(USER, AGENT);
  });
});
