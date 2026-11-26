import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { listBuiltinTools } from '../domain/builtin-tool-catalog.js';

export function registerBuiltinToolRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get('/api/builtin-tools', async () => {
    const items = listBuiltinTools();
    return { items, total: items.length };
  });
}
