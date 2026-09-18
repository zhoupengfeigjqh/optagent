/**
 * 文件路由（T039 / FR-020、FR-021 + 002 US6/US7 + 003 三空间改造）：
 * - POST /api/files/upload：multipart 上传——dir 为空间相对路径（数据准备需二级目录，
 *   二级目录须命中 scenario.json 清单），扩展名按空间策略（数据准备仅 csv/xlsx，
 *   共享/临时空间 csv/xlsx/txt/json/pdf + 图片），≤5MB（413），落盘名自动追加 _YYYYMMDD_HHMMSS
 * - 数据准备目录带字段约束（data_prep_fields）时：暂存后、落盘前校验上传表的
 *   表头与取值类型（`domain/field-check.ts`），失败 400 FILE_SCHEMA_INVALID（不落盘）
 * - GET /api/files/list?dir=：列目录
 * - GET /api/files/download?dir=&filename=：附件下载；路径穿越一律 400
 * - GET /api/files/preview?dir=&filename=：内联预览（Content-Disposition: inline，
 *   按扩展名映射 Content-Type；.xlsx 回退附件下载；超过预览上限 → 413）
 * - GET /api/files/workspace：三空间工作空间汇总（空间 → 子目录 → 文件 + 每空间策略）
 * - DELETE /api/files?dir=&filename=：删除文件（共享空间只读 → 403 FILE_READONLY）
 * - GET /api/files/raw：MCP 签名直链回源（见 003 spec）
 *
 * 文件空间视角＝**当前选中的数字人**：场景（scenario.json）随数字人存放，
 * 故同一用户的不同数字人可见的目录清单不同。未选中数字人 → 409 AGENT_NOT_SELECTED；
 * 选中但该数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED。
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  DirValidationError,
  ScenarioNotConfiguredError,
  SPACE_PREP,
  SPACE_POLICIES,
  SPACE_SHARED,
  SPACE_TMP,
  loadScenario,
  parseSpaceDir,
  userDataDir,
} from '../domain/dirs.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { checkUploadBuffer } from '../domain/field-check.js';
import { removeFileSafe } from '../domain/fs-safe.js';
import { ApiError } from '../server.js';
import { verifyRef } from '../infra/file-sign.js';

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

/**
 * 文件空间视角所属的数字人＝当前选中数字人（场景随数字人存放）。
 * 未选中时无法确定可见目录清单 → 409，与对话路由的判定口径保持一致。
 */
function currentAgentFor(ctx: AppContext, userId: string): string {
  const selected = ctx.currentAgent.current(userId);
  if (!selected) {
    throw new ApiError(409, 'AGENT_NOT_SELECTED', '请先选定数字人后再操作文件空间');
  }
  return selected.agentName;
}

/** 目录参数统一校验：穿越 → 400；空间外/清单外 → 403；scenario 缺失 → 503 */
function checkDir(ctx: AppContext, userId: string, agentName: string, dir: string) {
  try {
    return parseSpaceDir(ctx.config.optAgentRoot, userId, agentName, dir);
  } catch (err) {
    if (err instanceof DirValidationError) {
      throw new ApiError(
        err.statusCode,
        err.statusCode === 400 ? 'VALIDATION_FAILED' : 'UPLOAD_DIR_FORBIDDEN',
        err.message,
      );
    }
    if (err instanceof ScenarioNotConfiguredError) {
      throw new ApiError(503, 'SCENARIO_NOT_CONFIGURED', err.message);
    }
    throw err;
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
    // 扩展名校验依赖目标空间的策略（dir 可能晚于 file 到达），故延至 dir 确认后统一校验
    let dir: string | undefined;
    let staging: string | undefined;
    let originalName = 'file';
    let savedSize = 0;
    let truncated = false;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        // dir 可能还没解析到：先流式写入用户临时空间暂存，待 dir 确认后移动
        const tmpAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId), SPACE_TMP);
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
      const target = checkDir(ctx, userId, currentAgentFor(ctx, userId), dir);
      // 按目标空间策略校验扩展名
      const ext = path.extname(originalName).toLowerCase();
      const allowed = SPACE_POLICIES[target.space].uploadExtensions;
      if (!allowed.includes(ext)) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          `${target.space} 不支持格式 "${ext}"，允许：${allowed.join(' ')}`,
        );
      }
      // 字段约束校验（暂存后、落盘前）：仅数据准备目录且该目录声明了约束时触发。
      // 运行环境是唯一权威（前端不做同款校验，契约 §3.1）；失败不落盘。
      if (target.space === SPACE_PREP && target.sub) {
        const scenario = loadScenario(
          ctx.config.optAgentRoot,
          userId,
          currentAgentFor(ctx, userId),
          ctx.loggers.logger,
        );
        const fields = scenario.dataPrepFields[target.sub] ?? [];
        if (fields.length > 0) {
          const issues = checkUploadBuffer(fields, ext, fs.readFileSync(staging));
          if (issues.length > 0) {
            throw new ApiError(
              400,
              'FILE_SCHEMA_INVALID',
              '上传表不符合该目录的字段约束',
              issues,
            );
          }
        }
      }
      const dirAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId), target.relPath);
      fs.mkdirSync(dirAbs, { recursive: true });
      const name = stampedName(dirAbs, originalName);
      fs.renameSync(staging, path.join(dirAbs, name));
      return reply.status(201).send({ dir: target.relPath, filename: name, size: savedSize });
    } catch (err) {
      removeFileSafe(staging);
      throw err;
    }
  });

  app.get('/api/files/list', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { dir } = req.query as { dir: string };
    const target = checkDir(ctx, userId, currentAgentFor(ctx, userId), dir);
    const entries = await fileAccessFor(ctx, userId).list(target.relPath);
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
      const target = checkDir(ctx, userId, currentAgentFor(ctx, userId), dir);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId).readBuffer(`${target.relPath}/${filename}`);
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
      const target = checkDir(ctx, userId, currentAgentFor(ctx, userId), dir);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId).readBuffer(`${target.relPath}/${filename}`);
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

  // 文件空间删除（002 US8 / FR-031）：共享空间为只读，其余空间可删
  app.delete(
    '/api/files',
    { schema: { querystring: downloadQuerySchema } },
    async (req) => {
      const userId = getCurrentUser().userId;
      const { dir, filename } = req.query as { dir: string; filename: string };
      const target = checkDir(ctx, userId, currentAgentFor(ctx, userId), dir);
      if (target.space === SPACE_SHARED) {
        throw new ApiError(403, 'FILE_READONLY', `共享空间为只读目录，不支持删除: ${dir}`);
      }
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      try {
        await fileAccessFor(ctx, userId).remove(`${target.relPath}/${filename}`);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或已被清理: ${dir}/${filename}`);
        throw err;
      }
      return { dir: target.relPath, filename, deleted: true };
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

  // 三空间工作空间汇总（003 改造）：空间 → 子目录 → 文件，附每空间策略
  app.get('/api/files/workspace', async (_req) => {
    const userId = getCurrentUser().userId;
    const access = fileAccessFor(ctx, userId);
    const root = ctx.config.optAgentRoot;

    let scenario;
    try {
      scenario = loadScenario(root, userId, currentAgentFor(ctx, userId), ctx.loggers.logger);
    } catch (err) {
      if (err instanceof ScenarioNotConfiguredError) {
        throw new ApiError(503, 'SCENARIO_NOT_CONFIGURED', err.message);
      }
      throw err;
    }

    const listFiles = async (relPath: string) => {
      // 目录初始化时已预创建；运行中被删（如手动清理）按空目录容错
      const entries = await access.list(relPath).catch(() => []);
      return entries
        .filter((e) => !e.isDirectory)
        .map((e) => ({ filename: e.name, size: e.size, updated_at: e.modifiedAt }));
    };

    const spaces = [];
    for (const space of [SPACE_PREP, SPACE_SHARED, SPACE_TMP] as const) {
      const policy = SPACE_POLICIES[space];
      const subDirs =
        space === SPACE_PREP ? scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`) : [space];
      const dirs = [];
      for (const relPath of subDirs) {
        dirs.push({
          dir: relPath,
          label: relPath === space ? space : relPath.slice(space.length + 1),
          deletable: space !== SPACE_SHARED,
          files: await listFiles(relPath),
          // 字段约束随目录下发（无约束为 []）：前端据此在上传入口做只读提示；
          // 权威校验在上传路由执行，前端 MUST NOT 自行判定（契约 §3.1）
          fields:
            space === SPACE_PREP
              ? (scenario.dataPrepFields[relPath.slice(space.length + 1)] ?? [])
              : [],
        });
      }
      spaces.push({
        name: space,
        agent_writable: policy.agentWritable,
        upload_extensions: policy.uploadExtensions,
        dirs,
      });
    }
    return { scenario: scenario.name, spaces };
  });
}
