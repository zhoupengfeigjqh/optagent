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
