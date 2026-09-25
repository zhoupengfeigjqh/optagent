/**
 * 后台产出路由（R11，契约 §10.5）：
 * - `GET /api/produced?limit=50`：产出列表（有界返回，按完成时间倒序）
 * - `GET /api/produced/raw?job_id=`：读单条产出正文（**不走 files 预览接口**，见 §10.5 ⑦）
 * - `POST /api/produced/read`：批量标记已读（幂等；不存在的 `job_id` 忽略）
 * - `GET /api/produced/events`：SSE 信号（事件名 `produced`，**负载为空**；建连即推一次
 *   → 之后按 userId 过滤推送 → 25s 心跳）
 *
 * 信号语义：只表示"产出**可能**已变"，前端收到后重新拉列表；
 * 因此信号丢失无后果（产出物本身是文件，可从目录重算）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import {
  PRODUCED_LIST_MAX,
  findProduced,
  listProduced,
  markProducedRead,
} from '../domain/produced.js';
import type { ProducedItem } from '../domain/produced.js';
import { ApiError } from '../server.js';

const listQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: { limit: { type: 'string', minLength: 1 } },
} as const;

/**
 * 一次可标记的 `job_id` 条数上限（契约 §10.5 ⑤）。
 *
 * 界面是**一次提交当前未读的全部**，量级本就很小；这里设上限只为挡住异常/恶意请求体
 * ——真正有界的是产出目录本身（7 天内的产出数）。
 */
const READ_BATCH_MAX = 200;

const readBodySchema = {
  type: 'object',
  required: ['job_ids'],
  additionalProperties: false,
  properties: {
    job_ids: {
      type: 'array',
      maxItems: READ_BATCH_MAX,
      items: { type: 'string', minLength: 1 },
    },
  },
} as const;

const rawQuerySchema = {
  type: 'object',
  required: ['job_id'],
  additionalProperties: false,
  properties: { job_id: { type: 'string', minLength: 1 } },
} as const;

function accessFor(ctx: AppContext, userId: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
}

/**
 * 为产出列表补「发起它的数字人」（`agent_name`）。
 *
 * 产出是**用户级**的（同一用户的数字人共享一份 `user-data`），sidecar 只记 `sid`
 * （= thread_id）；要知道它属于哪个数字人，必须回查 `threads/{sid}/meta.json` 的
 * `agent_name`。刻意**不落 sidecar**：`agent_name` 会随会话跨数字人而变，落盘即第二份
 * 会漂移的真相（原则五）。
 *
 * 降级：`sid` 缺失、或会话 meta 不存在/损坏（如对话已删除）→ 该条**不带** `agent_name`，
 * 由界面显示"未知"。逐条 `get` 的读盘量 = **去重后**的会话数（≤ 列表上限），量级可忽略。
 */
function withAgentNames(ctx: AppContext, userId: string, items: ProducedItem[]): ProducedItem[] {
  const cache = new Map<string, string | undefined>();
  return items.map((item) => {
    const sid = item.sid;
    if (!sid) return item;
    if (!cache.has(sid)) {
      let name: string | undefined;
      try {
        name = ctx.threadStore.get(userId, sid).agentName;
      } catch {
        name = undefined; // 对话已删除 / meta 损坏：不因一条归属缺失而让整张列表失败
      }
      cache.set(sid, name);
    }
    const agentName = cache.get(sid);
    return agentName ? { ...item, agent_name: agentName } : item;
  });
}

export function registerProducedRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/produced', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const raw = (req.query as { limit?: string }).limit;
    const requested = raw === undefined ? PRODUCED_LIST_MAX : Number(raw);
    const limit =
      Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : PRODUCED_LIST_MAX;
    const items = await listProduced(accessFor(ctx, userId), limit);
    return { items: withAgentNames(ctx, userId, items) };
  });

  /**
   * §10.5 ⑤ 批量标记已读。
   *
   * 语义要点（均有契约依据）：**幂等**（已读的条目不动 `read_at`）、**不存在的 `job_id`
   * 忽略**（可能已被 7 天清理，不是调用方的错误）、返回**实际写入条数**。
   * 未读数不在这里算——界面从列表项自算（原则五：不落第二份可漂移的状态）。
   */
  /**
   * §10.5 ⑦ 读单条产出正文。
   *
   * **为什么不复用 `GET /api/files/preview`**：那个端点的 `dir` 是**空间顶层目录**
   * （数据准备的二级目录还须命中 `scenario.json` 清单），而产出在二级目录
   * `临时空间/后台产出/`——拿 `relPath` 当 `dir` 传必然被判 `VALIDATION_FAILED`。
   * 产出因此**以自己的身份（`job_id`）读取**：定位在产出目录内，不接任意路径。
   *
   * `content-type` 固定为文本 + `nosniff`：产出内容不该被浏览器当作 HTML 之类渲染。
   */
  app.get('/api/produced/raw', { schema: { querystring: rawQuerySchema } }, async (req, reply) => {
    const userId = getCurrentUser().userId;
    const { job_id } = req.query as { job_id: string };
    const access = accessFor(ctx, userId);
    const item = await findProduced(access, job_id);
    if (!item) {
      throw new ApiError(404, 'FILE_NOT_FOUND', `后台产出不存在或已被清理：${job_id}`);
    }
    let buf: Buffer;
    try {
      buf = await access.readBuffer(item.relPath);
    } catch (err) {
      // `PermissionError` 即"文件不存在或不可读"（目录被清理）= 与查不到同一语义
      if (err instanceof PermissionError) {
        throw new ApiError(404, 'FILE_NOT_FOUND', `后台产出不存在或已被清理：${job_id}`);
      }
      throw err;
    }
    const maxBytes = ctx.config.previewMaxMb * 1024 * 1024;
    if (buf.length > maxBytes) {
      throw new ApiError(
        413,
        'FILE_TOO_LARGE',
        `产出超过预览上限（${ctx.config.previewMaxMb}MB）`,
      );
    }
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('x-content-type-options', 'nosniff')
      .send(buf.toString('utf8'));
  });

  app.post('/api/produced/read', { schema: { body: readBodySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { job_ids } = req.body as { job_ids: string[] };
    const marked = await markProducedRead(accessFor(ctx, userId), job_ids);
    ctx.loggers.logger.info(
      { event: 'produced.read', user_id: userId, requested: job_ids.length, marked },
      `后台产出标记已读：${marked}/${job_ids.length}`,
    );
    return { marked };
  });

  app.get('/api/produced/events', (req, reply) => {
    const userId = getCurrentUser().userId;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    // 建连即推一次（与 MCP 状态推送同一形态）：客户端不必自己判断"是不是还没变化"
    const push = (): void => {
      reply.raw.write('event: produced\ndata: \n\n');
    };
    push();
    const unsubscribe = ctx.producedEvents.onChanged((changedUserId) => {
      if (changedUserId === userId) push();
    });
    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });
  });
}
