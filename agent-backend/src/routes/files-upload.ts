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

    let dir: string | undefined;
    let validatedTarget: ReturnType<typeof checkDir> | undefined;
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
            resolveAgent();
          } catch (err) {
            earlyError = err;
          }
        }
        if (earlyError) {
          for await (const chunk of part.file) {
            void chunk;
          }
          continue;
        }
        // dir 可能还没解析到：先流式写入**该数字人**临时空间暂存，待 dir 确认后移动
        const agent = resolveAgent();
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
            validatedTarget = checkDir(ctx, userId, resolveAgent(), dir);
          } catch (err) {
            earlyError = err;
          }
        }
      }
    }

    if (earlyError) {
      if (staging) removeFileSafe(staging);
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
      const agent = resolveAgent();
      // 早验命中直接用缓存结果（同一 dir 值已校验过），否则按旧顺序补验
      const target = validatedTarget ?? checkDir(ctx, userId, agent, dir);
      const ext = path.extname(originalName).toLowerCase();
      const scenario =
        target.space === SPACE_PREP && target.sub
          ? loadScenario(ctx.config.optAgentRoot, userId, agent, ctx.loggers.logger)
          : null;
      const allowed = uploadExtensionsOf(scenario, target.space, target.sub);
      if (!allowed.includes(ext)) {
        throw new ApiError(
          400,
          'VALIDATION_FAILED',
          `${target.space} 不支持格式 "${ext}"，允许：${allowed.join(' ')}`,
        );
      }
      // `supportsFieldCheck` 是唯一判据（非表格类型跳过，避免"缺少必填表头"描述一个本没有表头的文件，FR-020）。
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
