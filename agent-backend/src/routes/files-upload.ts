/**
 * 文件上传端点（012 从 `routes/files.ts` 迁出）：`POST /api/files/upload`。
 *
 * 独立成文件的原因同 `files-put.ts`：`files.ts` 已达 500 行硬门禁（宪章原则二），
 * 而本次恰好要改上传端点的落盘命名。按"一个端点族一个文件"拆开，只移动、不改其它端点。
 *
 * 行为要点（与迁移前一致，除落盘命名）：
 * - 逐 part 流式处理：`dir` 字段顺序无关；文件流先落**该数字人**临时空间暂存，不占内存；
 * - `dir` 先到即早验（目录合法性 / 选中态）→ 拒绝省带宽；早验失败不在迭代器内抛出
 *   （避免 Fastify 包成 500），改为排空后续文件段、循环外统一抛；
 * - 扩展名按**目标目录允许的类型**判定（`uploadExtensionsOf` 唯一实现）；
 * - 数据准备目录带字段约束且为表格类型时，暂存后、落盘前校验表结构，失败 400 不落盘；
 * - 落盘命名：**不重名用原名，重名 `原名(n).ext`**（`domain/upload-name.ts`，唯一实现），
 *   `filename` 直接回传落盘名，前端 MUST NOT 自行推算（契约 `contracts/http-upload.md`）。
 */
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { FastifyInstance } from 'fastify';

import type { AppContext } from '../context.js';
import { getCurrentUser } from '../domain/current-user.js';
import {
  SPACE_PREP,
  SPACE_TMP,
  loadScenario,
  uploadExtensionsOf,
  userDataDir,
} from '../domain/dirs.js';
import { checkUploadBuffer, supportsFieldCheck } from '../domain/field-check.js';
import { removeFileSafe } from '../domain/fs-safe.js';
import {
  UploadNameConflictError,
  UploadNameTooLongError,
  claimName,
} from '../domain/upload-name.js';
import { ApiError } from '../server.js';
import { checkDir, currentAgentFor } from './files-scope.js';

export function registerFileUploadRoute(app: FastifyInstance, ctx: AppContext): void {
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
      // 落盘命名 + 排他占名（012）：不重名原名，重名 `原名(n).ext`；并发零覆盖
      let name: string;
      try {
        name = claimName(dirAbs, originalName, staging);
      } catch (err) {
        if (err instanceof UploadNameConflictError) {
          throw new ApiError(409, 'FILE_NAME_CONFLICT', err.message);
        }
        if (err instanceof UploadNameTooLongError) {
          throw new ApiError(400, 'VALIDATION_FAILED', '文件名过长，无法落盘，请缩短文件名后重试');
        }
        throw err;
      }
      return reply.status(201).send({ dir: target.relPath, filename: name, size: savedSize });
    } catch (err) {
      removeFileSafe(staging);
      throw err;
    }
  });
}
