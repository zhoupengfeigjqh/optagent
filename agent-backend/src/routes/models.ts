/**
 * 模型路由（002 US5 / FR-022）：GET /api/models
 * config.yaml models 列表的只读投影；剥离 api_key/base_url 等敏感字段。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';

export function registerModelRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/models', async () => ({
    models: ctx.config.models.map((m) => ({
      model: m.model,
      is_default: m.model === ctx.config.defaultModel.model,
    })),
  }));
}
