import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import { ScenarioNotConfiguredError, SPACE_PREP, loadScenario } from '../domain/dirs.js';
import { buildWorkspaceView } from '../domain/workspace-view.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { xlsxToSheets, type PreviewWorkbook } from '../domain/preview/xlsx-sheets.js';
import { parseRuleFile, RULES_SUBDIR } from '../domain/rule-file.js';
import { ApiError } from '../server.js';
import { splitAgentScopedPath, verifyRef } from '../infra/file-sign.js';
import { checkDir, checkDirRead, currentAgentFor } from './files-scope.js';
import { registerFileUploadRoute } from './files-upload.js';
import { registerFilePutRoute } from './files-put.js';

const PREVIEW_CONTENT_TYPES: Record<string, string> = {
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.bmp': 'image/bmp',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  // 但**必须沙箱化**——它会在本站源下执行脚本，见 `appendHtmlSecurityHeaders`
  '.html': 'text/html; charset=utf-8',
};

const SCRIPTABLE_PREVIEW_EXT = '.html';

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
  registerFilePutRoute(app, ctx);
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
      // 读方向：额外放行 `临时空间/后台产出`（MCP 回写产出的 filePath 入口点开后落到这里）
      const target = checkDirRead(ctx, userId, agent, dir);
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
      const target = checkDirRead(ctx, userId, agent, dir);
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
      if (ext === '.xlsx') {
        let workbook: PreviewWorkbook;
        try {
          workbook = xlsxToSheets(buf);
        } catch {
          throw new ApiError(400, 'VALIDATION_FAILED', `无法解析 Excel 文件: ${filename}`);
        }
        return reply
          .header('content-type', 'application/json; charset=utf-8')
          .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)
          .send(workbook);
      }
      const contentType = PREVIEW_CONTENT_TYPES[ext];
      if (!contentType) {
        // 不可内联类型（如 .xls）回退附件下载
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
      appendHtmlSecurityHeaders(inline, ext);
      return inline.send(buf);
    },
  );

  app.get('/api/files/rules', async (_req) => {
    const userId = getCurrentUser().userId;
    const agent = currentAgentFor(ctx, userId);
    // 2026-11-17：预定义目录可被屏蔽——先判一次，屏蔽按"能力不可用"（404）呈现，
    assertRulesDirOpen(ctx, userId, agent);
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

  app.delete('/api/files', { schema: { querystring: downloadQuerySchema } }, async (req) => {
    const userId = getCurrentUser().userId;
    const { dir, filename } = req.query as { dir: string; filename: string };
    const agent = currentAgentFor(ctx, userId);
    const target = checkDir(ctx, userId, agent, dir);
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
    appendHtmlSecurityHeaders(raw, ext);
    return raw.send(buf);
  });

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

function assertRulesDirOpen(ctx: AppContext, userId: string, agentName: string): void {
  let dirs: readonly string[];
  try {
    dirs = loadScenario(ctx.config.optAgentRoot, userId, agentName).dataPrepDirs;
  } catch (err) {
    if (err instanceof ScenarioNotConfiguredError) return;
    throw err;
  }
  if (!dirs.includes(RULES_SUBDIR)) {
    throw new ApiError(
      404,
      'FILE_NOT_FOUND',
      `该数字人未开放「${SPACE_PREP}/${RULES_SUBDIR}」目录（管理员已在文件空间场景中屏蔽）`,
    );
  }
}
