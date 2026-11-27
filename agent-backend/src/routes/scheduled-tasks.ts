import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { onSseDisconnect } from '../infra/sse.js';
import {
  advanceToFuture,
  canStart,
  deriveStatus,
  firstRunAt,
  isTerminated,
} from '../domain/scheduled-task-schedule.js';
import type { ScheduleRun } from '../domain/scheduled-task-run-store.js';
import {
  ScheduledTaskExhaustedError,
  TASK_NAME_MAX,
  TASK_PROMPT_MAX,
  type CreateScheduledTaskInput,
  type ScheduledTask,
  type UpdateScheduledTaskInput,
} from '../domain/scheduled-task-store.js';
import { ApiError } from '../server.js';

const RUN_LIMIT_DEFAULT = 50;

const createBodySchema = {
  type: 'object',
  required: ['name', 'prompt', 'start_at', 'interval_seconds', 'max_runs', 'deadline_at'],
  additionalProperties: false,
  properties: {
    // 上限只做"明显超标"的第一道拦截，真正的字数口径在 `validateCreate`（按 Unicode 码点）
    name: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    start_at: { type: 'string', minLength: 1 },
    interval_seconds: { type: 'integer', minimum: 1 },
    max_runs: { type: 'integer', minimum: 1 },
    deadline_at: { type: 'string', minLength: 1 },
    // 015 增补：创建后不可修改（`FR-060`），故只出现在创建体里
    new_thread_per_run: { type: 'boolean' },
  },
} as const;

/**
 * 编辑请求体（2026-10-30 增补）：与创建同 7 项、**整份替换**（不是字段级 PATCH）。
 *
 * 刻意不含 `new_thread_per_run`：会话模式创建后不可改（`FR-060`），
 * 出现该字段按"未声明字段"直接 400，而不是静默忽略。
 */
const updateBodySchema = {
  type: 'object',
  required: ['name', 'prompt', 'start_at', 'interval_seconds', 'max_runs', 'deadline_at'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1 },
    prompt: { type: 'string', minLength: 1 },
    thinking: { type: 'boolean' },
    start_at: { type: 'string', minLength: 1 },
    interval_seconds: { type: 'integer', minimum: 1 },
    max_runs: { type: 'integer', minimum: 1 },
    deadline_at: { type: 'string', minLength: 1 },
  },
} as const;

const enabledBodySchema = {
  type: 'object',
  required: ['enabled'],
  additionalProperties: false,
  properties: { enabled: { type: 'boolean' } },
} as const;

const runsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task_id: { type: 'string', minLength: 1 },
    limit: { type: 'string', pattern: '^[0-9]+$' },
  },
} as const;

/** 允许出现的字段（与 schema 的 properties 同源，避免两处清单漂移） */
const CREATE_FIELDS = new Set(Object.keys(createBodySchema.properties));
const UPDATE_FIELDS = new Set(Object.keys(updateBodySchema.properties));
const ENABLED_FIELDS = new Set(Object.keys(enabledBodySchema.properties));

function assertKnownFields(allowed: ReadonlySet<string>, body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const unknown = Object.keys(body as Record<string, unknown>).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(unknown[0]!, `不支持的请求字段: ${unknown.join(', ')}`);
  }
}

interface EditableBody {
  name: string;
  prompt: string;
  thinking?: boolean;
  start_at: string;
  interval_seconds: number;
  max_runs: number;
  deadline_at: string;
}

interface CreateBody extends EditableBody {
  new_thread_per_run?: boolean;
}

type UpdateBody = EditableBody;

function invalid(field: string, message: string): never {
  throw new ApiError(400, 'VALIDATION_FAILED', message, [`${field}: ${message}`]);
}

function parseInstant(field: string, raw: string, label: string): number {
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) invalid(field, `${label}格式不是合法的日期时间`);
  return ms;
}

function validateEditable(
  body: EditableBody,
  nowMs: number,
  options: { requireFutureStart: boolean },
): UpdateScheduledTaskInput {
  const name = body.name.trim();
  if (name === '') invalid('name', '任务名称不能为空');
  if ([...name].length > TASK_NAME_MAX) {
    invalid('name', `任务名称不能超过 ${TASK_NAME_MAX} 个字符`);
  }
  const prompt = body.prompt.trim();
  if (prompt === '') invalid('prompt', '任务提示词不能为空');
  if ([...prompt].length > TASK_PROMPT_MAX) {
    invalid('prompt', `任务提示词不能超过 ${TASK_PROMPT_MAX} 个字符`);
  }
  const startMs = parseInstant('start_at', body.start_at, '执行开始时间');
  if (options.requireFutureStart && startMs <= nowMs) {
    invalid('start_at', '执行开始时间必须晚于当前时刻');
  }
  const deadlineMs = parseInstant('deadline_at', body.deadline_at, '有效截止时间');
  if (deadlineMs <= startMs) invalid('deadline_at', '有效截止时间必须晚于执行开始时间');
  if (!Number.isInteger(body.interval_seconds) || body.interval_seconds < 1) {
    invalid('interval_seconds', '执行间隔秒数必须是 ≥1 的整数');
  }
  if (!Number.isInteger(body.max_runs) || body.max_runs < 1) {
    invalid('max_runs', '执行次数必须是 ≥1 的整数');
  }
  return {
    name,
    prompt,
    thinking: body.thinking ?? false,
    startAt: new Date(startMs).toISOString(),
    intervalSeconds: body.interval_seconds,
    maxRuns: body.max_runs,
    deadlineAt: new Date(deadlineMs).toISOString(),
  };
}

function validateCreate(body: CreateBody, nowMs: number): CreateScheduledTaskInput {
  return {
    ...validateEditable(body, nowMs, { requireFutureStart: true }),
    newThreadPerRun: body.new_thread_per_run ?? true,
  };
}

function validateUpdate(body: UpdateBody, nowMs: number): UpdateScheduledTaskInput {
  return validateEditable(body, nowMs, { requireFutureStart: false });
}

function taskJson(task: ScheduledTask, nowMs: number) {
  return {
    task_id: task.taskId,
    name: task.name,
    prompt: task.prompt,
    thinking: task.thinking,
    start_at: task.startAt,
    interval_seconds: task.intervalSeconds,
    max_runs: task.maxRuns,
    deadline_at: task.deadlineAt,
    new_thread_per_run: task.newThreadPerRun !== false,
    enabled: task.enabled,
    executed_count: task.executedCount,
    status: deriveStatus(task, nowMs),
    terminated: isTerminated(task, nowMs),
    can_start: canStart(task, nowMs),
    disabled_reason: task.disabledReason,
    next_run_at: task.nextRunAt,
    last_run_at: task.lastRunAt,
    agent_name: task.agentName,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function runJson(run: ScheduleRun, threadDeleted: boolean) {
  return {
    run_id: run.runId,
    task_id: run.taskId,
    task_name: run.taskName,
    triggered_at: run.triggeredAt,
    finished_at: run.finishedAt,
    result: run.result,
    reason: run.reason,
    reason_text: run.reasonText,
    thread_id: run.threadId,
    thread_title: run.threadTitle,
    rebuilt: run.rebuilt === true,
    thread_deleted: threadDeleted,
  };
}

/** 列表读取的统一入口：损坏必须暴露（500 + 日志），MUST NOT 返回空数组冒充"还没有任务" */
function listTasks(ctx: AppContext, userId: string, agentName: string, route: string) {
  try {
    return ctx.scheduled.store.list(userId, agentName);
  } catch (err) {
    ctx.loggers.logger.error(
      { err, event: 'scheduled_task.list.failed', user_id: userId, agent_name: agentName, route },
      '定时任务数据损坏，无法读取列表',
    );
    throw err;
  }
}

export function registerScheduledTaskRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/scheduled-tasks', async () => {
    const userId = getCurrentUser().userId;
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再管理定时任务',
      route: 'GET /api/scheduled-tasks',
    });
    const nowMs = Date.now();
    const tasks = listTasks(ctx, userId, agentName, 'GET /api/scheduled-tasks');
    const sorted = [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { tasks: sorted.map((task) => taskJson(task, nowMs)) };
  });

  app.post(
    '/api/scheduled-tasks',
    {
      schema: { body: createBodySchema },
      preValidation: async (req) => assertKnownFields(CREATE_FIELDS, req.body),
    },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再创建定时任务',
        route: 'POST /api/scheduled-tasks',
      });
      const input = validateCreate(req.body as CreateBody, Date.now());
      const task = ctx.scheduled.store.create(userId, agentName, input);
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.created',
          user_id: userId,
          agent_name: agentName,
          task_id: task.taskId,
          interval_seconds: task.intervalSeconds,
          max_runs: task.maxRuns,
          new_thread_per_run: task.newThreadPerRun,
        },
        `定时任务已创建：${task.name}（未启用）`,
      );
      return reply.status(201).send({ task: taskJson(task, Date.now()) });
    },
  );

  app.patch(
    '/api/scheduled-tasks/:id',
    {
      schema: { body: updateBodySchema },
      preValidation: async (req) => assertKnownFields(UPDATE_FIELDS, req.body),
    },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { id: taskId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再编辑定时任务',
        route: 'PATCH /api/scheduled-tasks/:id',
      });
      const input = validateUpdate(req.body as UpdateBody, Date.now());
      const task = ctx.scheduled.store.update(userId, agentName, taskId, input);
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.updated',
          user_id: userId,
          agent_name: agentName,
          task_id: taskId,
          interval_seconds: task.intervalSeconds,
          max_runs: task.maxRuns,
          start_at: task.startAt,
        },
        `定时任务已编辑：${task.name}`,
      );
      return { task: taskJson(task, Date.now()) };
    },
  );

  app.patch(
    '/api/scheduled-tasks/:id/enabled',
    {
      schema: { body: enabledBodySchema },
      preValidation: async (req) => assertKnownFields(ENABLED_FIELDS, req.body),
    },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { id: taskId } = req.params as { id: string };
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再管理定时任务',
        route: 'PATCH /api/scheduled-tasks/:id/enabled',
      });
      const { enabled } = req.body as { enabled: boolean };
      const task = ctx.scheduled.store.get(userId, agentName, taskId);
      const nowMs = Date.now();

      let updated: ScheduledTask;
      if (enabled) {
        if (isTerminated(task, nowMs)) throw new ScheduledTaskExhaustedError(task.name);
        const base =
          task.nextRunAt === null ? firstRunAt(task.startAt) : Date.parse(task.nextRunAt);
        const from = Number.isFinite(base) ? base : nowMs;
        const nextMs = advanceToFuture(from, task.intervalSeconds, nowMs);
        updated = ctx.scheduled.store.setEnabled(
          userId,
          agentName,
          taskId,
          true,
          new Date(nextMs).toISOString(),
        );
      } else {
        updated = ctx.scheduled.store.setEnabled(userId, agentName, taskId, false);
      }
      ctx.scheduled.events.emitChanged(userId);
      ctx.loggers.logger.info(
        {
          event: 'scheduled_task.enabled.changed',
          user_id: userId,
          agent_name: agentName,
          task_id: taskId,
          enabled,
          next_run_at: updated.nextRunAt,
        },
        enabled ? `定时任务已启用：${task.name}` : `定时任务已停用：${task.name}`,
      );
      return { task: taskJson(updated, Date.now()) };
    },
  );

  app.delete('/api/scheduled-tasks/:id', async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { id: taskId } = req.params as { id: string };
    const { agentName } = resolveAgentScope(ctx, userId, {
      notSelectedMessage: '请先选定数字人后再管理定时任务',
      route: 'DELETE /api/scheduled-tasks/:id',
    });
    // 启用中直接 409（`FR-018`）；停用则原子移除（一次临时文件 + rename）
    ctx.scheduled.store.remove(userId, agentName, taskId);
    ctx.scheduled.events.emitChanged(userId);
    ctx.loggers.logger.info(
      { event: 'scheduled_task.deleted', user_id: userId, agent_name: agentName, task_id: taskId },
      '定时任务已删除（会话与历史保留）',
    );
    return reply.status(204).send();
  });

  app.get(
    '/api/scheduled-tasks/runs',
    { schema: { querystring: runsQuerySchema } },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人后再查看运行记录',
        route: 'GET /api/scheduled-tasks/runs',
      });
      const query = req.query as { task_id?: string; limit?: string };
      const requested = query.limit === undefined ? RUN_LIMIT_DEFAULT : Number(query.limit);
      const limit = Number.isFinite(requested) ? Math.floor(requested) : RUN_LIMIT_DEFAULT;

      const tasks = listTasks(ctx, userId, agentName, 'GET /api/scheduled-tasks/runs');
      const { runs, total } = ctx.scheduled.runs.read(userId, agentName, {
        ...(query.task_id === undefined ? {} : { taskId: query.task_id }),
        onlyTaskIds: tasks.map((task) => task.taskId),
        limit,
      });

      // 会话存在性：按**去重后**的 thread_id 判定，不逐条查（避免 N+1）
      const deleted = new Map<string, boolean>();
      const isDeleted = (threadId: string): boolean => {
        let value = deleted.get(threadId);
        if (value === undefined) {
          value = !ctx.threadStore.exists(userId, agentName, threadId);
          deleted.set(threadId, value);
        }
        return value;
      };
      return {
        runs: runs.map((run) =>
          runJson(run, run.threadId === null ? false : isDeleted(run.threadId)),
        ),
        total,
      };
    },
  );

  app.get('/api/scheduled-tasks/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const push = (): void => {
      reply.raw.write('event: scheduled-task\ndata: \n\n');
    };
    push();
    const unsubscribe = ctx.scheduled.events.onChanged(userId, push);
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    // 断连钩子必须挂响应：`req.raw` 的 close 在请求体读完时已触发过（见 infra/sse.ts）
    onSseDisconnect(reply.raw, () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
