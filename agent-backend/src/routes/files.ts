/**
 * 文件路由（T039 / FR-020、FR-021 + 002 US6/US7 + 003 三空间改造）：
 * - POST /api/files/upload：已**迁到 `files-upload.ts`**（012：本文件达 500 行硬门禁，
 *   且该端点的落盘命名要改——不重名用原名、重名 `原名(n).ext`，唯一实现在
 *   `domain/upload-name.ts`）。早验、字段约束、类型白名单等细节见该文件头注释
 * - GET /api/files/list?dir=：列目录
 * - GET /api/files/download?dir=&filename=：附件下载；路径穿越一律 400
 * - GET /api/files/preview?dir=&filename=：内联预览（Content-Disposition: inline，
 *   按扩展名映射 Content-Type；.xlsx/.xls 回退附件下载；超过预览上限 → 413）
 * - GET /api/files/workspace：三空间工作空间汇总（空间 → 子目录 → 文件 + 每空间策略 +
 *   目录级可上传类型 `upload_extensions`）
 * - GET /api/files/rules：HITL「从算法规则选择」数据源——「数据准备/算法规则」最新
 *   规则文件（updated_at 最大）解析成结构化行（columns/rows/priority_column）
 * - DELETE /api/files?dir=&filename=：删除文件（共享空间只读 → 403 FILE_READONLY）
 * - GET /api/files/raw：MCP 签名直链回源（见 003 spec）
 *
 * **归属（009）**：文件空间视角＝**当前选中的数字人**，且路径根是**该数字人的数据域**
 * （`user-data/{数字人}/`）。相对路径语义不变（`数据准备/生产计划`、`共享空间`…），
 * 但解析结果随数字人而异 ⇒ 跨数字人访问在路径层不可达（403 DIR_VALIDATION / 404）。
 * 场景（scenario.json）随数字人存放，故同一用户的不同数字人可见的目录清单不同。
 * 未选中数字人 → 409 AGENT_NOT_SELECTED；选中但不可用 → 409 AGENT_NOT_AVAILABLE；
 * 选中但该数字人未配置场景 → 503 SCENARIO_NOT_CONFIGURED。
 */
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  ScenarioNotConfiguredError,
  SPACE_PREP,
  SPACE_SHARED,
  loadScenario,
} from '../domain/dirs.js';
import { buildWorkspaceView } from '../domain/workspace-view.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { parseRuleFile, RULES_SUBDIR } from '../domain/rule-file.js';
import { ApiError } from '../server.js';
import { splitAgentScopedPath, verifyRef } from '../infra/file-sign.js';
import { checkDir, currentAgentFor } from './files-scope.js';
import { registerFileUploadRoute } from './files-upload.js';
import { registerFilePutRoute } from './files-put.js';

/** 内联预览 Content-Type 映射；.xlsx/.xls 前端无法内联渲染，回退附件下载 */
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
  // 2026-10-20：用户上传的 `.html` 可内联（文件空间里点开即渲染，与 PDF 同形态），
  // 但**必须沙箱化**——它会在本站源下执行脚本，见 `appendHtmlSecurityHeaders`
  '.html': 'text/html; charset=utf-8',
};

/** 需要在同源下执行脚本的预览类型（目前只有用户上传的 HTML） */
const SCRIPTABLE_PREVIEW_EXT = '.html';

/**
 * 给用户上传的 HTML 响应补安全头（内联预览与 `raw` 直链**共用**）。
 *
 * 不加这两条的后果：上传一个带 `<script>` 的 HTML，点开预览就等于在平台源上执行它
 * （读取本站 Cookie / 存储、调用本站接口）——即"存储型 XSS 的入口"。
 *
 * - `Content-Security-Policy: sandbox`：把文档降为**唯一不透明源**且**不执行脚本**
 *   （等价于 iframe 的 `sandbox=""`），CSS 与图片照常渲染；
 * - `X-Content-Type-Options: nosniff`：禁止浏览器把被声明为 HTML 的内容再猜成别的类型。
 *
 * 前端 iframe 另有 `sandbox=""` 作为第二道保险（双保险不冲突）。
 */
function appendHtmlSecurityHeaders(
  reply: { header(key: string, value: string): unknown },
  ext: string,
): void {
  if (ext !== SCRIPTABLE_PREVIEW_EXT) return;
  reply.header('content-security-policy', 'sandbox');
  reply.header('x-content-type-options', 'nosniff');
}

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

function fileAccessFor(ctx: AppContext, userId: string, agentName: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    agentName,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
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
  // R11：后台产出回写端点（实现见 `files-put.ts`）
  registerFilePutRoute(app, ctx);
  // 上传端点（012 迁到独立文件，见 `files-upload.ts`）
  registerFileUploadRoute(app, ctx);

  app.get('/api/files/list', { schema: { querystring: listQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { dir } = req.query as { dir: string };
    const agent = currentAgentFor(ctx, userId);
    const target = checkDir(ctx, userId, agent, dir);
    const entries = await fileAccessFor(ctx, userId, agent).list(target.relPath);
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
      const agent = currentAgentFor(ctx, userId);
      const target = checkDir(ctx, userId, agent, dir);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId, agent).readBuffer(`${target.relPath}/${filename}`);
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
      const agent = currentAgentFor(ctx, userId);
      const target = checkDir(ctx, userId, agent, dir);
      if (filename !== path.basename(filename) || filename.includes('..')) {
        throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
      }
      let buf: Buffer;
      try {
        buf = await fileAccessFor(ctx, userId, agent).readBuffer(`${target.relPath}/${filename}`);
      } catch (err) {
        if (err instanceof PermissionError)
          throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或已被清理: ${dir}/${filename}`);
        throw err;
      }
      const maxBytes = ctx.config.previewMaxMb * 1024 * 1024;
      if (buf.length > maxBytes) {
        throw new ApiError(
          413,
          'FILE_TOO_LARGE',
          `文件超过预览上限（${ctx.config.previewMaxMb}MB），请使用下载`,
        );
      }
      const ext = path.extname(filename).toLowerCase();
      const contentType = PREVIEW_CONTENT_TYPES[ext];
      if (!contentType) {
        // 不可内联类型（如 .xlsx/.xls）回退附件下载
        return reply
          .header('content-type', 'application/octet-stream')
          .header(
            'content-disposition',
            `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          )
          .send(buf);
      }
      const inline = reply
        .header('content-type', contentType)
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`);
      // `.html`：沙箱化后内联（脚本不执行、不共享本站源）
      appendHtmlSecurityHeaders(inline, ext);
      return inline.send(buf);
    },
  );

  // HITL「从算法规则选择」数据源：取「数据准备/算法规则」中 updated_at 最新的
  // 规则文件（.xlsx / .csv），解析成结构化行返回（解析在服务端，前端只渲染）。
  app.get('/api/files/rules', async (_req) => {
    const userId = getCurrentUser().userId;
    const agent = currentAgentFor(ctx, userId);
    const target = checkDir(ctx, userId, agent, `${SPACE_PREP}/${RULES_SUBDIR}`);
    const access = fileAccessFor(ctx, userId, agent);

    let entries;
    try {
      entries = await access.list(target.relPath);
    } catch (err) {
      if (err instanceof PermissionError) {
        throw new ApiError(404, 'FILE_NOT_FOUND', `算法规则目录不可读：${target.relPath}`);
      }
      throw err;
    }
    const files = entries.filter((e) => !e.isDirectory);
    if (files.length === 0) {
      throw new ApiError(
        404,
        'FILE_NOT_FOUND',
        `「${SPACE_PREP}/${RULES_SUBDIR}」目录暂无文件，请先上传规则文件`,
      );
    }
    // 「最新」按 mtime 判定（与 list 接口的 updated_at 同一来源）
    const latest = files.reduce((a, b) =>
      Date.parse(b.modifiedAt) > Date.parse(a.modifiedAt) ? b : a,
    );

    const maxBytes = ctx.config.previewMaxMb * 1024 * 1024;
    let buf: Buffer;
    try {
      buf = await access.readBuffer(`${target.relPath}/${latest.name}`);
    } catch (err) {
      if (err instanceof PermissionError) {
        throw new ApiError(404, 'FILE_NOT_FOUND', `规则文件不存在或已被清理: ${latest.name}`);
      }
      throw err;
    }
    if (buf.length > maxBytes) {
      throw new ApiError(
        413,
        'FILE_TOO_LARGE',
        `规则文件超过大小上限（${ctx.config.previewMaxMb}MB）`,
      );
    }

    let parsed;
    try {
      parsed = parseRuleFile(latest.name, buf);
    } catch (err) {
      throw new ApiError(422, 'FILE_SCHEMA_INVALID', (err as Error).message);
    }
    return {
      filename: latest.name,
      updated_at: latest.modifiedAt,
      columns: parsed.columns,
      rows: parsed.rows,
      priority_column: parsed.priority_column,
    };
  });

  // 文件空间删除（002 US8 / FR-031）：共享空间为只读，其余空间可删
  app.delete('/api/files', { schema: { querystring: downloadQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { dir, filename } = req.query as { dir: string; filename: string };
    const agent = currentAgentFor(ctx, userId);
    const target = checkDir(ctx, userId, agent, dir);
    if (target.space === SPACE_SHARED) {
      throw new ApiError(403, 'FILE_READONLY', `共享空间为只读目录，不支持删除: ${dir}`);
    }
    if (filename !== path.basename(filename) || filename.includes('..')) {
      throw new ApiError(400, 'VALIDATION_FAILED', `非法文件名: ${filename}`);
    }
    try {
      await fileAccessFor(ctx, userId, agent).remove(`${target.relPath}/${filename}`);
    } catch (err) {
      if (err instanceof PermissionError)
        throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或已被清理: ${dir}/${filename}`);
      throw err;
    }
    return { dir: target.relPath, filename, deleted: true };
  });

  // MCP 签名直链（远程/跨容器服务回源下载）：HMAC 绑定 (u, p, exp)，URL 即凭证，无需会话。
  // 009：`p` = `{数字人}/{数字人数据域内相对路径}`（数字人段同样在签名内 ⇒ 不可篡改），
  // 因此跨数字人读取在签名层即不可达；形状不合法一律 404（与"文件不存在"不可区分）。
  app.get('/api/files/raw', { schema: { querystring: rawQuerySchema } }, async (req, reply) => {
    const { u, p, exp, sig } = req.query as { u: string; p: string; exp: string; sig: string };
    const expNum = Number(exp);
    if (!verifyRef(ctx.config.fileSignSecret, u, p, expNum, sig)) {
      throw new ApiError(403, 'FILE_SIGN_INVALID', '签名无效或已过期');
    }
    const signed = splitAgentScopedPath(p);
    if (!signed) {
      throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或不可访问: ${p}`);
    }
    let buf: Buffer;
    try {
      buf = await fileAccessFor(ctx, u, signed.agentName).readBuffer(signed.relPath);
    } catch (err) {
      if (err instanceof PermissionError)
        throw new ApiError(404, 'FILE_NOT_FOUND', `文件不存在或不可访问: ${p}`);
      throw err;
    }
    const ext = path.extname(p).toLowerCase();
    const raw = reply
      .header('content-type', PREVIEW_CONTENT_TYPES[ext] ?? 'application/octet-stream')
      .header('cache-control', 'no-store');
    // 直链同样可能被浏览器**直接打开**：`.html` 不沙箱化就是一次同源 XSS
    appendHtmlSecurityHeaders(raw, ext);
    return raw.send(buf);
  });

  // 三空间工作空间汇总（003 改造）：空间 → 子目录 → 文件，附每空间策略
  // 2026-10-13：响应体装配拆到 `domain/workspace-view.ts`（本文件行数逼近 500 门禁，原则二）
  app.get('/api/files/workspace', async (_req) => {
    const userId = getCurrentUser().userId;
    const agent = currentAgentFor(ctx, userId);

    let scenario;
    try {
      scenario = loadScenario(ctx.config.optAgentRoot, userId, agent, ctx.loggers.logger);
    } catch (err) {
      if (err instanceof ScenarioNotConfiguredError) {
        throw new ApiError(503, 'SCENARIO_NOT_CONFIGURED', err.message);
      }
      throw err;
    }

    return buildWorkspaceView(scenario, fileAccessFor(ctx, userId, agent));
  });
}
