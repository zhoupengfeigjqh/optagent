/**
 * 后台产出**回写**端点（R11，契约 §10.3）。
 *
 * 独立成文件的原因：`routes/files.ts` 因本特性新增该端点后越过 500 行硬门禁
 * （宪章原则二）。按"一个端点族一个文件"拆开，比继续往大文件里堆更合规，
 * 也不动既有的上传 / 列表 / 预览 / 下载 / 删除 / 回源逻辑。
 */
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { PRODUCED_DIR } from '../domain/dirs.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { writeProduced } from '../domain/produced.js';
import { verifyPutRef } from '../infra/file-sign.js';
import { ApiError } from '../server.js';

/**
 * 查询参数：前五个必须，其余三个是**归属提示参数**
 * （`sid`/`call_id`/`tool`，由运行环境铸造 URL 时预置、服务原样回传，**不参与验签**）。
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
    // 由**服务提供**的一行摘要（面向人可读，如"识别到 47 行文字"）；可缺省。归一规则见 `clampSummary`
    summary: { type: 'string' },
  },
} as const;

/** 摘要长度上限（契约 §10.3）：超出**截断**而非拒绝——任务已经算完，不该因摘要过长而失败 */
const SUMMARY_MAX_CHARS = 200;

/** 归一摘要：去空白；空串等同缺省；超长按**码点**截断（不切开 emoji 等代理对） */
function clampSummary(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const chars = Array.from(trimmed);
  return chars.length > SUMMARY_MAX_CHARS ? chars.slice(0, SUMMARY_MAX_CHARS).join('') : trimmed;
}

/**
 * 回写 body → 结果字节。
 *
 * 三种到达形态：`application/octet-stream` / `text/plain`（Buffer，见 `server.ts` 的
 * content-type parser）、`application/json`（Fastify 已解析成对象）、无 body（返回
 * `null` → 400，**不写空文件**——"服务算完但结果为空"应让调用方知道）。
 */
function toResultBytes(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body.length > 0 ? body : null;
  if (typeof body === 'string') return body.length > 0 ? Buffer.from(body, 'utf8') : null;
  if (body === undefined || body === null) return null;
  const text = JSON.stringify(body);
  return text.length > 0 ? Buffer.from(text, 'utf8') : null;
}

export function registerFilePutRoute(app: FastifyInstance, ctx: AppContext): void {
  // 这是既有 `/api/files/raw`（签名**读**直链）的镜像，复用同一密钥与验签设施；
  // 但 payload 是**四段**（`put\nu\nd\nexp`），与读方向三段形状隔离
  // ⇒ 读签名不能被改用来写（§10.6 不变式 3）。
  app.post('/api/files/put', { schema: { querystring: putQuerySchema } }, async (req, reply) => {
    const { u, d, exp, sig, filename, sid, call_id, tool, summary } = req.query as Record<
      string,
      string | undefined
    >;
    if (!verifyPutRef(ctx.config.fileSignSecret, u!, d!, Number(exp), sig!)) {
      throw new ApiError(403, 'FILE_SIGN_INVALID', '签名无效或已过期');
    }
    // 目录白名单再收一道：即便签名合法，也只允许写产出目录（`d` 本就在签名内）
    if (d !== PRODUCED_DIR) {
      throw new ApiError(400, 'VALIDATION_FAILED', `不允许的写入目录：${d}`);
    }
    if (filename !== path.basename(filename!) || filename!.includes('..')) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
    }
    const content = toResultBytes(req.body);
    if (content === null) {
      throw new ApiError(400, 'VALIDATION_FAILED', '请求体为空，无法写入产出');
    }
    try {
      const saved = await writeProduced({
        access: new FileAccess({
          optAgentRoot: ctx.config.optAgentRoot,
          userId: u!,
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
      });
      // 落盘即推信号（负载为空）：前端收到后重拉列表；信号丢失无后果（可从目录重算）
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
