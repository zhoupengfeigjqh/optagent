import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { PRODUCED_DIR } from '../domain/dirs.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { META_SUFFIX, writeProduced } from '../domain/produced.js';
import { splitAgentScopedPath, verifyPutRef } from '../infra/file-sign.js';
import { ApiError } from '../server.js';

/**
 * 查询参数：前五个必须，其余是**提示参数**
 * （`sid`/`call_id`/`tool` + 提交时刻 `t`，由运行环境铸造 URL 时预置、服务原样回传，
 * **不参与验签**）。
 */
const putQuerySchema = {
  type: 'object',
  required: ['u', 'd', 'exp', 'sig', 'filename'],
  additionalProperties: false,
  properties: {
    u: { type: 'string', minLength: 1 },
    d: { type: 'string', minLength: 1 },
    exp: { type: 'string', minLength: 1 },
    sig: { type: 'string', minLength: 1 },
    filename: { type: 'string', minLength: 1 },
    sid: { type: 'string' },
    call_id: { type: 'string' },
    tool: { type: 'string' },
    t: { type: 'string' },
    summary: { type: 'string' },
  },
} as const;

/** 摘要长度上限（契约 §10.3）：超出**截断**而非拒绝——任务已经算完，不该因摘要过长而失败 */
const SUMMARY_MAX_CHARS = 200;

function clampSummary(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const chars = Array.from(trimmed);
  return chars.length > SUMMARY_MAX_CHARS ? chars.slice(0, SUMMARY_MAX_CHARS).join('') : trimmed;
}

export function parseSubmittedAt(
  raw: string | undefined,
  now: number = Date.now(),
): Date | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > now) return undefined;
  return new Date(value);
}

function toResultBytes(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body.length > 0 ? body : null;
  if (typeof body === 'string') return body.length > 0 ? Buffer.from(body, 'utf8') : null;
  if (body === undefined || body === null) return null;
  const text = JSON.stringify(body);
  return text.length > 0 ? Buffer.from(text, 'utf8') : null;
}

export function registerFilePutRoute(app: FastifyInstance, ctx: AppContext): void {
  // ⇒ 读签名不能被改用来写（§10.6 不变式 3）。
  app.post('/api/files/put', { schema: { querystring: putQuerySchema } }, async (req, reply) => {
    const { u, d, exp, sig, filename, sid, call_id, tool, summary, t } = req.query as Record<
      string,
      string | undefined
    >;
    if (!verifyPutRef(ctx.config.fileSignSecret, u!, d!, Number(exp), sig!)) {
      throw new ApiError(403, 'FILE_SIGN_INVALID', '签名无效或已过期');
    }
    // `d` 的形状（009）：`{数字人}/{数字人数据域内相对路径}`，数字人段在签名内不可篡改；
    const scoped = splitAgentScopedPath(d!);
    if (!scoped || scoped.relPath !== PRODUCED_DIR) {
      // 越界写入拒绝同样落结构化日志（FR-051）：签名合法但目录不在白名单，必须能追溯
      ctx.loggers.logger.warn(
        {
          alert: false,
          event: 'dir.validation.rejected',
          user_id: u,
          agent_name: scoped?.agentName ?? null,
          dir: d,
          status_code: 400,
          reason: 'not_produced_dir',
        },
        `回写目录被拒（uid=${u} dir=${d}）：只允许写 ${PRODUCED_DIR}`,
      );
      throw new ApiError(400, 'VALIDATION_FAILED', `不允许的写入目录：${d}`);
    }
    if (filename !== path.basename(filename!) || filename!.includes('..')) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
    }
    // 正文不得冒充 sidecar（2026-10-27）：`scanProduced` 按后缀识别元数据，一条内容为
    // 这里给出 400；`writeProduced` 内还保留一道兜底（防绕过路由的直接调用）。
    if (filename!.toLowerCase().endsWith(META_SUFFIX)) {
      throw new ApiError(400, 'VALIDATION_FAILED', `产出文件名不得以 ${META_SUFFIX} 结尾: ${filename}`);
    }
    const content = toResultBytes(req.body);
    if (content === null) {
      throw new ApiError(400, 'VALIDATION_FAILED', '请求体为空，无法写入产出');
    }
    try {
      const now = new Date();
      const createdAt = parseSubmittedAt(t, now.getTime());
      const saved = await writeProduced({
        access: new FileAccess({
          optAgentRoot: ctx.config.optAgentRoot,
          userId: u!,
          agentName: scoped.agentName,
          logger: ctx.loggers.logger,
          truncateKb: ctx.config.readTruncateKb,
        }),
        sid,
        callId: call_id,
        tool,
        summary: clampSummary(summary),
        filename: filename!,
        content,
        userId: u!,
        createdAt,
        now,
      });
      ctx.producedEvents.emitChanged(u!);
      ctx.loggers.logger.info(
        {
          event: 'produced.put',
          user_id: u,
          thread_id: sid ?? null,
          tool: tool ?? null,
          size: saved.size,
        },
        `后台产出已落盘：${saved.relPath}`,
      );
      return reply.status(202).send({ path: saved.relPath, size: saved.size });
    } catch (err) {
      if (err instanceof PermissionError) {
        throw new ApiError(400, 'VALIDATION_FAILED', err.message);
      }
      throw err;
    }
  });
}
