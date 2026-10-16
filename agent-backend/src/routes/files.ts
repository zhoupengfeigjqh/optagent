/**
 * 文件路由（T039 / FR-020、FR-021 + 002 US6/US7 + 003 三空间改造）：
 * - POST /api/files/upload：multipart 上传——dir 为空间相对路径（数据准备需二级目录，
 *   二级目录须命中 scenario.json 清单），扩展名按**该目标允许的类型**判定
 *   （2026-10-13 起：数据准备的**每个二级目录**各自一份白名单 `scenario.data_prep_uploads`，
 *   缺省回落平台默认 csv/xlsx；共享/临时空间仍取 `SPACE_POLICIES`，
 *   即 csv/xlsx/xls/txt/json/pdf + 图片），≤5MB（413），落盘名自动追加 _YYYYMMDD_HHMMSS
 * - 数据准备目录带字段约束（data_prep_fields）且上传**表格类型**（`.csv`/`.xlsx`/`.xls`）时：
 *   暂存后、落盘前校验上传表的表头与取值类型（`domain/field-check.ts`），
 *   失败 400 FILE_SCHEMA_INVALID（不落盘）；非表格类型跳过表结构校验（FR-020）
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
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  DirValidationError,
  ScenarioNotConfiguredError,
  SPACE_PREP,
  SPACE_SHARED,
  SPACE_TMP,
  loadScenario,
  parseSpaceDir,
  uploadExtensionsOf,
  userDataDir,
} from '../domain/dirs.js';
import { buildWorkspaceView } from '../domain/workspace-view.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { checkUploadBuffer, supportsFieldCheck } from '../domain/field-check.js';
import { removeFileSafe } from '../domain/fs-safe.js';
import { parseRuleFile, RULES_SUBDIR } from '../domain/rule-file.js';
import { ApiError } from '../server.js';
import { splitAgentScopedPath, verifyRef } from '../infra/file-sign.js';
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

function fileAccessFor(ctx: AppContext, userId: string, agentName: string): FileAccess {
  return new FileAccess({
    optAgentRoot: ctx.config.optAgentRoot,
    userId,
    agentName,
    logger: ctx.loggers.logger,
    truncateKb: ctx.config.readTruncateKb,
  });
}

/**
 * 文件空间视角所属的数字人＝当前选中数字人（场景随数字人存放，数据域亦随数字人）。
 *
 * 判定**复用唯一入口** `resolveAgentScope`（未选中 → 409 AGENT_NOT_SELECTED；
 * 选中但不可用 → 409 AGENT_NOT_AVAILABLE）：本文件只负责沿用既有文案，MUST NOT
 * 再写一遍"查选中态"的逻辑（双实现漂移，FR-023）。
 */
function currentAgentFor(ctx: AppContext, userId: string): string {
  return resolveAgentScope(ctx, userId, {
    notSelectedMessage: '请先选定数字人后再操作文件空间',
    route: 'files',
  }).agentName;
}

/** 目录参数统一校验：穿越 → 400；空间外/清单外 → 403；scenario 缺失 → 503 */
function checkDir(ctx: AppContext, userId: string, agentName: string, dir: string) {
  try {
    return parseSpaceDir(ctx.config.optAgentRoot, userId, agentName, dir);
  } catch (err) {
    if (err instanceof DirValidationError) {
      // 越界拒绝 MUST 可观测（FR-051）：含用户标识、数字人标识与请求线索（被拒的目录参数）
      ctx.loggers.logger.warn(
        {
          alert: false,
          event: 'dir.validation.rejected',
          user_id: userId,
          agent_name: agentName,
          dir,
          status_code: err.statusCode,
          reason: err.message,
        },
        `目录参数被拒（uid=${userId} agent=${agentName} dir=${dir}）：${err.message}`,
      );
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
  // R11：后台产出回写端点（实现见 `files-put.ts`）
  registerFilePutRoute(app, ctx);
  app.post('/api/files/upload', async (req, reply) => {
    const userId = getCurrentUser().userId;
    if (!req.isMultipart())
      throw new ApiError(400, 'VALIDATION_FAILED', '请求须为 multipart/form-data');

    // 逐 part 流式处理：dir 字段顺序无关；文件流直接落盘不占用内存
    // 扩展名校验依赖目标空间的策略（dir 可能晚于 file 到达），故延至 dir 确认后统一校验
    let dir: string | undefined;
    /** dir 先到（或重复出现）时立即校验并缓存，循环后复用（早验一次，拒绝省带宽） */
    let validatedTarget: ReturnType<typeof checkDir> | undefined;
    /**
     * 早验失败记录于此。刻意**不在 parts 迭代器内抛出**：中途抛错请求体没排完，
     * Fastify 会把原始错误包成 500；改为排空后续文件段、循环外统一抛（状态码保真）。
     */
    let earlyError: unknown;
    /**
     * 归属数字人：**懒解析 + 早验失败缓存**。
     *
     * 暂存目录也是**该数字人**的临时空间（009），而 `dir` 字段可能晚于文件段到达，
     * 因此这里按需解析；解析失败（未选中 / 不可用）与目录校验失败同一处置——
     * 记入 `earlyError`、排空文件段、循环外统一抛（不 500，见下方注释）。
     */
    let agentName: string | undefined;
    let agentError: unknown;
    const resolveAgent = (): string => {
      if (agentName !== undefined) return agentName;
      if (agentError !== undefined) throw agentError;
      try {
        agentName = currentAgentFor(ctx, userId);
        return agentName;
      } catch (err) {
        agentError = err;
        throw err;
      }
    };
    let staging: string | undefined;
    let originalName = 'file';
    let savedSize = 0;
    let truncated = false;
    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        if (!earlyError) {
          try {
            resolveAgent(); // 无归属数字人则无处暂存：视为早验失败
          } catch (err) {
            earlyError = err;
          }
        }
        if (earlyError) {
          // 已早验失败：排空文件段（不暂存），让请求体完整消费完，错误在循环外抛出
          for await (const chunk of part.file) {
            void chunk; // 丢弃
          }
          continue;
        }
        // dir 可能还没解析到：先流式写入**该数字人**临时空间暂存，待 dir 确认后移动
        const agent = resolveAgent(); // 缓存命中：上面已解析成功（失败即上面已 continue）
        const tmpAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId, agent), SPACE_TMP);
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
        if (!earlyError) {
          try {
            // 早验：dir 先于 file 到达时，目录合法性/选中态在**文件上传之前**即拒绝，
            // 省带宽与暂存 IO；file 先到的旧顺序退回「先收后验」（结果一致，仅时机不同）
            validatedTarget = checkDir(ctx, userId, resolveAgent(), dir);
          } catch (err) {
            earlyError = err;
          }
        }
      }
    }

    if (earlyError) {
      if (staging) removeFileSafe(staging); // dir 先到时可能尚未暂存
      throw earlyError;
    }

    if (truncated)
      throw new ApiError(413, 'FILE_TOO_LARGE', `文件超过大小上限（${ctx.config.uploadMaxMb}MB）`);
    if (!staging) throw new ApiError(400, 'VALIDATION_FAILED', '缺少文件字段 file');
    if (!dir) {
      removeFileSafe(staging);
      throw new ApiError(400, 'VALIDATION_FAILED', '缺少目标目录字段 dir');
    }
    try {
      const agent = resolveAgent(); // 归属数字人（早验阶段通常已解析，缓存命中）
      // 早验命中直接用缓存结果（同一 dir 值已校验过），否则按旧顺序补验
      const target = validatedTarget ?? checkDir(ctx, userId, agent, dir);
      const ext = path.extname(originalName).toLowerCase();
      // 数据准备目录：载入该数字人场景（目录级白名单与字段约束的共同来源）；其余空间不读场景
      const scenario =
        target.space === SPACE_PREP && target.sub
          ? loadScenario(ctx.config.optAgentRoot, userId, agent, ctx.loggers.logger)
          : null;
      // 允许上传的类型：**唯一实现** `uploadExtensionsOf`（数据准备按目录、缺省回落平台默认；
      // 其余空间恒取 SPACE_POLICIES）。提示含允许类型，满足 FR-042 / SC-002。
      const allowed = uploadExtensionsOf(scenario, target.space, target.sub);
      if (!allowed.includes(ext)) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          `${target.space} 不支持格式 "${ext}"，允许：${allowed.join(' ')}`,
        );
      }
      // 字段约束校验（暂存后、落盘前）：仅**数据准备目录**且**该类型需要表结构校验**且该目录声明了约束时触发。
      // `supportsFieldCheck` 是唯一判据（非表格类型跳过，避免"缺少必填表头"描述一个本没有表头的文件，FR-020）。
      // 运行环境是唯一权威（前端不做同款校验，契约 §3.1）；失败不落盘。
      if (scenario && target.sub && supportsFieldCheck(ext)) {
        const fields = scenario.dataPrepFields[target.sub] ?? [];
        if (fields.length > 0) {
          const issues = checkUploadBuffer(fields, ext, fs.readFileSync(staging));
          if (issues.length > 0) {
            throw new ApiError(400, 'FILE_SCHEMA_INVALID', '上传表不符合该目录的字段约束', issues);
          }
        }
      }
      const dirAbs = path.join(userDataDir(ctx.config.optAgentRoot, userId, agent), target.relPath);
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
      return reply
        .header('content-type', contentType)
        .header('content-disposition', `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)
        .send(buf);
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
    return reply
      .header('content-type', PREVIEW_CONTENT_TYPES[ext] ?? 'application/octet-stream')
      .header('cache-control', 'no-store')
      .send(buf);
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
