/**
 * 本体管理路由（`contracts/admin-api.md` §10，2026-10-03）。
 *
 * 定位：MCP 服务与 SKILL 管理之间的**只读浏览区**（`FR-058`~`FR-061`）。
 * - 本体来源：本体市场（optonto `.data/onto_market/{场景}/{本体}/`，平台只读）——
 *   **同步 `ontology.yaml` 与 `securities.yaml` 两个文件**（后者为行为安全管控，可选）；
 * - 平台侧**不提供任何编辑本体的端点**：唯一写入口是"从本体市场导入/更新"，
 *   写入的是市场快照——管理员只能查看（`FR-059`）；
 * - 本体身份 = **场景名 + 本体目录名**（同一目录名可存在于不同场景），
 *   故详情/删除把场景放在查询参数 `scenario` 上（路由只承载单段 detail，`FR-053`）。
 */
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

/** 查询参数里的场景名（本体身份的一半，必填） */
function requireScenario(raw: unknown): string {
  const scenario = typeof raw === 'string' ? raw.trim() : '';
  if (scenario === '') {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      '查询参数 scenario 必填（本体以「场景 + 本体目录名」为身份）',
    );
  }
  return scenario;
}

/** 导入/更新的请求体（市场侧三级路径中的后两段） */
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
    const paged = ctx.ontologies.list(page);
    return {
      ...paged,
      items: paged.items.map((item) => ({
        scenario: item.scenario,
        ontology_dir: item.ontology_dir,
        name: item.name,
        metadata: item.metadata,
        source: item.source,
        hash: item.hash,
        has_securities: item.securities_hash !== null,
        installed_at: item.installed_at,
        updated_at: item.updated_at,
      })),
    };
  });

  /**
   * §10.2 本体详情（**只读**）：记录 + `ontology.yaml` 全文（+ 已同步时的
   * `securities.yaml` 全文）。
   *
   * 界面用它渲染只读视图；后端没有任何"保存本体"的对应端点。
   */
  app.get('/api/admin/ontologies/:name', async (req) => {
    const { name } = req.params as { name: string };
    const query = (req.query ?? {}) as { scenario?: unknown };
    return ctx.ontologies.read(requireScenario(query.scenario), name);
  });

  /** §10.3 删除（`FR-061`）；本体不被任何对象引用，故无需引用清单 */
  app.delete('/api/admin/ontologies/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const query = (req.query ?? {}) as { scenario?: unknown };
    const scenario = requireScenario(query.scenario);
    ctx.ontologies.remove(scenario, name);
    markAudit(req, { target: `${scenario}/${name}`, extra: { action: 'ontology_remove' } });
    return reply.status(204).send();
  });

  /**
   * §10.4 本体市场：列出可导入的本体及其与库内的差异状态（`FR-060`）。
   *
   * 只读扫描 `ONTO_MARKET_DIR`（未配置时 `configured: false`，不报错）；
   * 打开本接口即完成一次"文件是否变化"的检查（`ontology.yaml` + `securities.yaml`
   * 两个 sha256 比对，任一不同即 `changed`）。
   */
  app.get('/api/admin/ontologies/onto-market', async () => {
    return listOntoMarketOntologies(ctx.config.ontoMarketDir, ctx.ontologies);
  });

  /** §10.5 从本体市场导入（重复导入 → 409 `ADM_ONTOLOGY_EXISTS`，界面应改用更新） */
  app.post('/api/admin/ontologies/onto-market/import', async (req, reply) => {
    const ref = requireRef((req.body ?? {}) as Record<string, unknown>);
    const result = importOntoMarketOntology(ctx.config.ontoMarketDir, ctx.ontologies, ref);
    markAudit(req, {
      target: `${result.scenario}/${result.ontology_dir}`,
      extra: { source: `onto_market:${result.scenario}`, action: 'ontology_import' },
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
      target: `${result.scenario}/${result.ontology_dir}`,
      extra: { action: 'ontology_update' },
    });
    return reply.status(200).send(result);
  });
}
