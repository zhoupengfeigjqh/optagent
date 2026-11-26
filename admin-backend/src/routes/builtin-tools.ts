import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { normalizeLimit } from '../domain/paging.js';

interface ToolProjection {
  name?: unknown;
  label?: unknown;
  description_template?: unknown;
  parameters?: unknown;
  writable?: unknown;
}

export function registerBuiltinToolRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/admin/builtin-tools', async (req) => {
    const query = (req.query ?? {}) as { limit?: unknown };
    const limit = normalizeLimit(query.limit, 50, 200);

    // 运行环境不可达时抛 ADM_RUNTIME_UNREACHABLE（不静默返回空清单）
    const tools = await ctx.catalog.builtinTools();

    // 只保留契约声明的五个字段，避免把运行环境的内部字段泄漏到管理契约里
    const items = tools.slice(0, limit).map((tool) => {
      const raw = tool as ToolProjection;
      return {
        name: String(raw.name ?? ''),
        label: String(raw.label ?? ''),
        description_template: String(raw.description_template ?? ''),
        parameters: (raw.parameters ?? {}) as Record<string, unknown>,
        writable: raw.writable === true,
      };
    });

    return { items, total: tools.length, truncated: items.length < tools.length };
  });
}
