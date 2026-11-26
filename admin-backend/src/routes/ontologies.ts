import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import { markAudit } from '../domain/audit.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import {
  importOntoMarketOntology,
  listOntoMarketOntologies,
  updateOntoMarketOntology,
  type OntologyMarketRef,
} from '../domain/ontology/market.js';
import { normalizePage } from '../domain/paging.js';

function requireRef(body: Record<string, unknown>): OntologyMarketRef {
  const scenario = typeof body.scenario === 'string' ? body.scenario.trim() : '';
  const ontologyDir = typeof body.ontology_dir === 'string' ? body.ontology_dir.trim() : '';
  if (scenario === '' || ontologyDir === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'scenario / ontology_dir 均为必填');
  }
  return { scenario, ontology_dir: ontologyDir };
}

export function registerOntologyRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * §10.1 本体卡片列表（分页：服务端固定 8 条/页，与其它卡片列表一致）。
   *
   * 卡片展示所需的一切（6 项 metadata + 路径 + 时间 + 是否含安全管控）都在索引里，
   * **不下发任何文件全文**——正文按需在详情接口取（避免列表把大文件带出来）。
   */
  app.get('/api/admin/ontologies', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown };
    const page = normalizePage(query.page);
    return ctx.ontologies.list(page);
  });

  app.get('/api/admin/ontologies/:scenario_name/:ontology_name', async (req) => {
    const { scenario_name: scenario, ontology_name: ontologyName } = req.params as {
      scenario_name: string;
      ontology_name: string;
    };
    return ctx.ontologies.read(scenario, ontologyName);
  });

  app.delete('/api/admin/ontologies/:scenario_name/:ontology_name', async (req, reply) => {
    const { scenario_name: scenario, ontology_name: ontologyName } = req.params as {
      scenario_name: string;
      ontology_name: string;
    };
    ctx.ontologies.remove(scenario, ontologyName);
    markAudit(req, {
      target: `${scenario}/${ontologyName}`,
      extra: { action: 'ontology_remove' },
    });
    return reply.status(204).send();
  });

  app.get('/api/admin/ontologies/onto-market', async () => {
    return listOntoMarketOntologies(ctx.config.ontoMarketDir, ctx.ontologies);
  });

  app.post('/api/admin/ontologies/onto-market/import', async (req, reply) => {
    const ref = requireRef((req.body ?? {}) as Record<string, unknown>);
    const result = importOntoMarketOntology(ctx.config.ontoMarketDir, ctx.ontologies, ref);
    markAudit(req, {
      target: `${result.metadata.scenario_name}/${result.metadata.ontology_name}`,
      extra: {
        source: `onto_market:${result.metadata.scenario_name}`,
        action: 'ontology_import',
      },
    });
    return reply.status(201).send(result);
  });

  /**
   * §10.6 用市场现版本更新（`FR-061`）。
   *
   * 与技能不同**没有"人工修改确认"**：本体只读、平台无编辑通道，
   * 库内内容必然等于上次导入的市场快照，整体替换没有"会丢本地修改"的风险。
   */
  app.post('/api/admin/ontologies/onto-market/update', async (req, reply) => {
    const ref = requireRef((req.body ?? {}) as Record<string, unknown>);
    const result = updateOntoMarketOntology(ctx.config.ontoMarketDir, ctx.ontologies, ref);
    markAudit(req, {
      target: `${result.metadata.scenario_name}/${result.metadata.ontology_name}`,
      extra: { action: 'ontology_update' },
    });
    return reply.status(200).send(result);
  });
}
