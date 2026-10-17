/**
 * 本体管理路由（`contracts/admin-api.md` §10，2026-10-03）。
 *
 * 定位：MCP 服务与 SKILL 管理之间的**只读浏览区**（`FR-058`~`FR-061`）。
 * - 本体来源：本体市场（optonto `.data/onto_market/{场景}/{本体}/`，平台只读）——
 *   **同步 `ontology.yaml` 与 `securities.yaml` 两个文件**（后者为行为安全管控，2026-10-17 起两个均为必需）；
 * - 平台侧**不提供任何编辑本体的端点**：唯一写入口是"从本体市场导入/更新"，
 *   写入的是市场快照——管理员只能查看（`FR-059`）；
 * - 本体身份 = **`metadata.scenario_name` + `metadata.ontology_name`**（同一本体名可存在于
 *   不同场景）。**身份即 URL**：`/{scenario_name}/{ontology_name}`，顺序与
 *   `metadata` 字段、与部署路径 `ontology/{场景}/{本体}/` 完全一致（2026-10-17）；
 *   响应里不再下发 `scenario` / `ontology_dir` / `name` / `source` 这些副本
 *   （卡片与 URL 都直接读 `metadata`，副本没有第二个消费者）。
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

/** 导入/更新的请求体：`scenario` + `ontology_dir`（两级目录名，内部按它定位市场） */
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
    // 视图本身不含文件正文；身份只在 `metadata.scenario_name` / `ontology_name` 里
    // （2026-10-17 起不再下发 scenario / ontology_dir / name / source 四个副本）
    return ctx.ontologies.list(page);
  });

  /**
   * §10.2 本体详情（**只读**）：记录 + `ontology.yaml` 全文（+ 已同步时的
   * `securities.yaml` 全文）。
   *
   * 界面用它渲染只读视图；后端没有任何"保存本体"的对应端点。
   */
  app.get('/api/admin/ontologies/:scenario_name/:ontology_name', async (req) => {
    const { scenario_name: scenario, ontology_name: ontologyName } = req.params as {
      scenario_name: string;
      ontology_name: string;
    };
    return ctx.ontologies.read(scenario, ontologyName);
  });

  /** §10.3 删除（`FR-061`）；本体不被任何对象引用，故无需引用清单 */
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
