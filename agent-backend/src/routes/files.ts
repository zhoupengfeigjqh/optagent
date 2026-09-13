/**
 * 文件路由（T039 / FR-020、FR-021 + 002 US6/US7）：
 * - POST /api/files/upload：multipart 上传——dir 白名单（7 业务目录+shared+tmp，
 *   002 起 tmp 放开上传）、扩展名白名单（.csv/.xlsx/.txt/.json/.pdf + 图片 .jpg/.jpeg/.png/.bmp/.webp/.gif/.tif/.tiff）、≤50MB（413），
 *   落盘名自动追加 _YYYYMMDD_HHMMSS
 * - GET /api/files/list?dir=：列目录
 * - GET /api/files/download?dir=&filename=：附件下载；路径穿越一律 400
 * - GET /api/files/preview?dir=&filename=：内联预览（Content-Disposition: inline，
 *   按扩展名映射 Content-Type；.xlsx 回退附件下载；超过预览上限 → 413）
 * - GET /api/files/workspace：工作空间汇总（全部白名单目录的文件清单）
 * - DELETE /api/files?dir=&filename=：删除文件（shared 为共享只读目录 → 403 FILE_READONLY）
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import { BUSINESS_DIRS, SHARED_DIR, TMP_DIR, userDataDir } from '../domain/dirs.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { removeFileSafe } from '../domain/fs-safe.js';
import { ApiError } from '../server.js';
import { verifyRef } from '../infra/file-sign.js';

const ALLOWED_EXTENSIONS = new Set([
  '.csv', '.xlsx', '.txt', '.json', '.pdf',
  // 图片：供 OCR MCP 识别、前端内联预览
  '.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff',
]);
const UPLOAD_DIRS: readonly string[] = [...BUSINESS_DIRS, SHARED_DIR, TMP_DIR];
const LIST_DIRS: readonly string[] = UPLOAD_DIRS;

/** 内联预览 Content-Type 映射；.xlsx 前端无法内联渲染，回退附件下载 */
const PREVIEW_CONTENT_TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const listQuerySchema = {
  type: 'object',
  required: ['dir'],
  additionalProperties: false,
  properties: { dir: { type: 'string', minLength: 1 } },
} as const;

const downloadQuerySchema = {
  type: 'object',
  required: ['dir', 'filename'],
  additionalProperties: false,
  properties: {
    dir: { type: 'string', minLength: 1 },
    filename: { type: 'string', minLength: 1 },
  },
} as const;

function fileAccessFor(ctx: AppContext, userId: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
}

/** dir/filename 含穿越特征 → 400；否则按白名单 → 403 */
function checkDir(dir: string, allowed: readonly string[]): void {
  if (dir.includes('..') || path.isAbsolute(dir) || /[/\\]/.test(dir)) {
    throw new ApiError(400, 'VALIDATION_FAILED', `非法目录参数: ${dir}`);
  }
  if (!allowed.includes(dir)) {
    throw new ApiError(
      403,
      'UPLOAD_DIR_FORBIDDEN',
      `目录 ${dir} 不开放，允许：${allowed.join('、')}`,
    );
  }
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 落盘名：name_YYYYMMDD_HHMMSS.ext（同名碰撞追加 -1/-2…） */
function stampedName(dirAbs: string, original: string): string {
  const base = path.basename(original).replace(/[/\\]/g, '_');
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length) || 'file';
  let name = `${stem}_${timestamp()}${ext}`;
  let i = 0;
  while (fs.existsSync(path.join(dirAbs, name))) {
    i += 1;
    name = `${stem}_${timestamp()}-${i}${ext}`;
  }
  return name;
}

const rawQuerySchema = {
  type: 'object',
  required: ['u', 'p', 'exp', 'sig'],
  additionalProperties: false,
  properties: {
    u: { type: 'string', minLength: 1 },
    p: { type: 'string', minLength: 1 },
    exp: { type: 'string', minLength: 1 },
    sig: { type: 'string', minLength: 1 },
  },
} as const;

export function registerFileRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/files/upload', async (req, reply) => {
    const userId = getCurrentUser().userId;
    if (!req.isMultipart())
      throw new ApiError(400, 'VALIDATION_FAILED', '请求须为 multipart/form-data');

    // 逐 part 流式处理：dir 字段顺序无关；文件流直接落盘不占用内存
    let dir: string | undefined;
    let staging: string | undefined;
    let originalName = 'file';
    let savedSize = 0;
    let truncated = false;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const ext = path.extname(part.filename ?? '').toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          // 排空流避免连接悬挂，再拒绝
          await new Promise<void>((res) => {
            part.file.on('end', res);
            part.file.resume();
          });
          throw new ApiError(
            400,
            'VALIDATION_FAILED',
            `不支持的文件格式 "${ext}"，允许：${[...ALLOWED_EXTENSIONS].join(' ')}`,
          );
        }
        // dir 可能还没解析到：先流式写入用户 tmp 暂存，待 dir 确认后移动
        const tmpAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId), TMP_DIR);
        fs.mkdirSync(tmpAbs, { recursive: true });
        staging = path.join(tmpAbs, `.upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        try {
          await pipeline(part.file, createWriteStream(staging));
        } catch (err) {
          removeFileSafe(staging);
          throw err;
        }
        if (part.file.truncated) {
          truncated = true;
          removeFileSafe(staging);
          staging = undefined;
          break;
        }
        originalName = part.filename ?? 'file';
        savedSize = fs.statSync(staging).size;
      } else if (part.fieldname === 'dir') {
        dir = String(part.value);
      }
    }

    if (truncated)
      throw new ApiError(413, 'FILE_TOO_LARGE', `文件超过大小上限（${ctx.config.uploadMaxMb}MB）`);
    if (!staging) throw new ApiError(400, 'VALIDATION_FAILED', '缺少文件字段 file');
    if (!dir) {
      removeFileSafe(staging);
      throw new ApiError(400, 'VALIDATION_FAILED', '缺少目标目录字段 dir');
    }
    try {
      checkDir(dir, UPLOAD_DIRS);
      const dirAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId), dir);
      fs.mkdirSync(dirAbs, { recursive: true });
      const name = stampedName(dirAbs, originalName);
      fs.renameSync(staging, path.join(dirAbs, name));
      return reply.status(201).send({ dir, filename: name, size: savedSize });
    } catch (err) {
      removeFileSafe(staging);
      throw err;
    }
  });

  app.get('/api/files/list', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { dir } = req.query as { dir: string };
    checkDir(dir, LIST_DIRS);
    const entries = await fileAccessFor(ctx, userId).list(dir);
    return entries
      .filter((e) => !e.isDirectory)
      .map((e) => ({ filename: e.name, size: e.size, updated_at: e.modifiedAt }));
  });

  app.get(
    '/api/files/download',
    { schema: { querystring: downloadQuerySchema } },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { dir, filename } = req.query as { dir: string; filename: string };
      checkDir(dir, LIST_DIRS);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId).readBuffer(`${dir}/${filename}`);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在: ${dir}/${filename}`);
        throw err;
      }
      return reply
        .header('content-type', 'application/octet-stream')
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        )
        .send(buf);
    },
  );

  // 002 US6 / FR-026/027：内联预览（inline；超预览上限 413；.xlsx 回退附件下载）
  app.get(
    '/api/files/preview',
    { schema: { querystring: downloadQuerySchema } },
    async (req, reply) => {
      const userId = getCurrentUser().userId;
      const { dir, filename } = req.query as { dir: string; filename: string };
      checkDir(dir, LIST_DIRS);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId).readBuffer(`${dir}/${filename}`);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或已被清理: ${dir}/${filename}`);
        throw err;
      }
      const maxBytes = ctx.config.previewMaxMb * 1024 * 1024;
      if (buf.length > maxBytes) {
        throw new ApiError(413, 'FILE_TOO_LARGE', `文件超过预览上限（${ctx.config.previewMaxMb}MB），请使用下载`);
      }
      const ext = path.extname(filename).toLowerCase();
      const contentType = PREVIEW_CONTENT_TYPES[ext];
      if (!contentType) {
        // 不可内联类型（如 .xlsx）回退附件下载
        return reply
          .header('content-type', 'application/octet-stream')
          .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
          .send(buf);
      }
      return reply
        .header('content-type', contentType)
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buf);
    },
  );

  // 文件空间删除（002 US8 / FR-031）：shared 为共享只读目录，其余 8 个目录可删
  app.delete(
    '/api/files',
    { schema: { querystring: downloadQuerySchema } },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { dir, filename } = req.query as { dir: string; filename: string };
      checkDir(dir, LIST_DIRS);
      if (dir === SHARED_DIR) {
        throw new ApiError(403, 'FILE_READONLY', `共享空间为只读目录，不支持删除: ${dir}`);
      }
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      try {
        await fileAccessFor(ctx, userId).remove(`${dir}/${filename}`);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或已被清理: ${dir}/${filename}`);
        throw err;
      }
      return { dir, filename, deleted: true };
    },
  );

  // MCP 签名直链（远程/跨容器服务回源下载）：HMAC 绑定 (u, p, exp)，URL 即凭证，无需会话
  app.get(
    '/api/files/raw',
    { schema: { querystring: rawQuerySchema } },
    async (req, reply) => {
      const { u, p, exp, sig } = req.query as { u: string; p: string; exp: string; sig: string };
      const expNum = Number(exp);
      if (!verifyRef(ctx.config.fileSignSecret, u, p, expNum, sig)) {
        throw new ApiError(403, 'FILE_SIGN_INVALID', '签名无效或已过期');
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, u).readBuffer(p);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或不可访问: ${p}`);
        throw err;
      }
      const ext = path.extname(p).toLowerCase();
      return reply
        .header('content-type', PREVIEW_CONTENT_TYPES[ext] ?? 'application/octet-stream')
        .header('cache-control', 'no-store')
        .send(buf);
    },
  );

  // 002 US7 / FR-030：工作空间汇总（全部白名单目录，空目录返回空数组）
  app.get('/api/files/workspace', async (_req) => {
    const userId = getCurrentUser().userId;
    const access = fileAccessFor(ctx, userId);
    const dirs = [];
    for (const dir of LIST_DIRS) {
      // 目录启动时已预创建；运行中被删（如手动清理）按空目录容错
      const entries = await access.list(dir).catch(() => []);
      dirs.push({
        dir,
        files: entries
          .filter((e) => !e.isDirectory)
          .map((e) => ({ filename: e.name, size: e.size, updated_at: e.modifiedAt })),
      });
    }
    return { dirs };
  });
}
