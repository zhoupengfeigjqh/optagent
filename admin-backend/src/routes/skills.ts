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
import {
  installOntoMarketSkill,
  listOntoMarket,
  updateOntoMarketSkill,
} from '../domain/skill-library/onto-market.js';

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
        display_name: item.display_name,
        description: item.description,
        installed_at: item.installed_at,
        updated_at: item.updated_at,
        source: item.source,
        origin: item.origin ?? null,
      })),
    };
  });

  app.get('/api/admin/skills/:name', async (req) => {
    const { name } = req.params as { name: string };
    return ctx.skills.read(name);
  });

  app.get('/api/admin/skills/:name/file', async (req) => {
    const { name } = req.params as { name: string };
    const query = (req.query ?? {}) as { path?: unknown };
    return ctx.skills.readFile(name, query.path);
  });

  app.put('/api/admin/skills/:name/file', async (req) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { path?: unknown; content?: unknown; base_hash?: unknown };
    return ctx.skills.writeFile(name, body.path, body.content, body.base_hash);
  });

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
    if (buffer.length < 4 || buffer.readUInt32LE(0) !== ZIP_MAGIC) {
      throw new ApiError(ERROR_CODES.ADM_SKILL_ARCHIVE_INVALID, '上传内容不是 ZIP 压缩包（缺少 PK 头）');
    }

    const result = await ctx.skills.install(buffer, { overwrite, source });

    markAudit(req, {
      target: result.name,
      extra: { source, overwritten: result.overwritten },
    });
    return reply.status(201).send(result);
  });

  app.get('/api/admin/skills/onto-market', async () => {
    return listOntoMarket(ctx.config.ontoMarketDir, ctx.skills);
  });

  /**
   * §4.7 从本体市场导入技能（2026-10-02）。
   *
   * 按路径 `{scenario}/{ontology}/skills/{skill}` 读取市场目录，复用库的全部校验
   * （frontmatter、名称安全、**重名直接拒绝**——市场导入不提供覆盖）；成功即原子入驻。
   */
  app.post('/api/admin/skills/onto-market/install', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : '';
    const ontology = typeof body.ontology === 'string' ? body.ontology.trim() : '';
    const skill = typeof body.skill === 'string' ? body.skill.trim() : '';
    if (scenario === '' || ontology === '' || skill === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'scenario / ontology / skill 均为必填');
    }
    const result = installOntoMarketSkill(ctx.config.ontoMarketDir, ctx.skills, {
      scenario,
      ontology,
      skill,
    });
    markAudit(req, {
      target: result.name,
      extra: { source: `onto_market:${scenario}/${ontology}` },
    });
    return reply.status(201).send(result);
  });

  app.post('/api/admin/skills/onto-market/update', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : '';
    const ontology = typeof body.ontology === 'string' ? body.ontology.trim() : '';
    const skill = typeof body.skill === 'string' ? body.skill.trim() : '';
    const confirm = body.confirm === true;
    if (scenario === '' || ontology === '' || skill === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'scenario / ontology / skill 均为必填');
    }
    const result = updateOntoMarketSkill(
      ctx.config.ontoMarketDir,
      ctx.skills,
      { scenario, ontology, skill },
      { confirmModified: confirm },
    );
    const affectedAgents = ctx.agents
      .listAll()
      .filter((doc) => doc.skills.includes(result.name))
      .map((doc) => doc.name);
    markAudit(req, {
      target: result.name,
      extra: {
        source: `onto_market:${scenario}/${ontology}`,
        locally_modified: result.locally_modified,
      },
    });
    return reply.status(200).send({ ...result, affected_agents: affectedAgents });
  });

  app.delete('/api/admin/skills/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    ctx.skills.remove(name);
    return reply.status(204).send();
  });
}
