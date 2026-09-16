/**
 * SKILL 管理路由（`contracts/admin-api.md` §4.1~§4.5）。
 *
 * 共享技能库是 SKILL 的**唯一权威来源**（`FR-036`）：一个 SKILL 可被任意数量的
 * 数字人以名称引用。安装目标 MUST 是共享技能库，**MUST NOT 直接写入某个数字人的
 * 技能目录**（`FR-037`）。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { markAudit } from '../domain/audit.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';

/** ZIP 的 local file header 魔数（`PK\x03\x04`） */
const ZIP_MAGIC = 0x04034b50;

export function registerSkillRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/skills', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown };
    const page = normalizePage(query.page);
    const paged = ctx.skills.list(page);
    return {
      ...paged,
      items: paged.items.map((item) => ({
        name: item.name,
        description: item.description,
        installed_at: item.installed_at,
        updated_at: item.updated_at,
        source: item.source,
      })),
    };
  });

  app.get('/api/admin/skills/:name', async (req) => {
    const { name } = req.params as { name: string };
    return ctx.skills.read(name);
  });

  /**
   * §4.3 读取技能内单个文件（`SKILL.md`、`references/`、`scripts/` 等）。
   *
   * 返回 `hash`（内容哈希，编辑的乐观锁基准）与 `editable`（文本且完整才可编辑）。
   */
  app.get('/api/admin/skills/:name/file', async (req) => {
    const { name } = req.params as { name: string };
    const query = (req.query ?? {}) as { path?: unknown };
    return ctx.skills.readFile(name, query.path);
  });

  /**
   * §4.3 编辑并保存技能内单个文件（2026-09-16 产品决定：**全部文件可编辑**）。
   *
   * - 并发保护：请求体带 `base_hash`（读文件时拿到的哈希），不符即 409
   *   `ADM_CONFIG_REVISION_CONFLICT`，**MUST NOT 静默覆盖**他人改动；
   * - 只允许**文本且完整**的文件（二进制、超限文件一律拒写，与 `editable` 同一判据）；
   * - 保存只更新共享技能库：引用了该 SKILL 的数字人需**重新部署**才会拿到新版本
   *   （`FR-026`、`SC-009`），运行环境侧由配置指纹自动感知（`FR-034`）。
   */
  app.put('/api/admin/skills/:name/file', async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { path?: unknown; content?: unknown; base_hash?: unknown };
    return ctx.skills.writeFile(name, body.path, body.content, body.base_hash);
  });

  /**
   * §4.4 上传 ZIP 安装到共享技能库。
   *
   * 全部校验**在写入目标目录之前**完成（`archive.ts`）；失败回滚、
   * **MUST NOT 留下半解压残留**（`FR-039`、`FR-041`）。
   *
   * 用 `req.parts()` 顺序遍历而非先 `req.file()`：`overwrite` 字段可能排在
   * 文件之后，逐个 part 收集可避开对字段顺序的依赖。
   */
  app.post('/api/admin/skills/install', async (req, reply) => {
    let buffer: Buffer | null = null;
    let source = 'upload.zip';
    let overwrite = false;

    for await (const part of req.parts()) {
      if (part.type === 'file') {
        buffer = await part.toBuffer();
        source = part.filename || source;
      } else if (part.fieldname === 'overwrite') {
        overwrite = String(part.value) === 'true';
      }
    }

    if (!buffer) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '缺少上传文件字段 file');
    }
    // 按**魔数**判定而非扩展名：扩展名可伪造，且契约要求"压缩包可正常解压"前置
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZIP_MAGIC) {
      throw new ApiError(
        ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID,
        '上传内容不是 ZIP 压缩包（缺少 PK 头）',
      );
    }

    const result = await ctx.skills.install(buffer, { overwrite, source });

    // 审计标注：multipart 请求在统一审计钩子看来没有任何字段，
    // 技能名与"是否覆盖"只有这里知道（`domain/audit.ts`）
    markAudit(req, {
      target: result.name,
      extra: { source, overwritten: result.overwritten },
    });
    return reply.status(201).send(result);
  });

  /** §4.5 删除；被引用时的确认清单由界面经 §7.1 取得（`FR-042`） */
  app.delete('/api/admin/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    ctx.skills.remove(name);
    return reply.status(204).send();
  });
}
