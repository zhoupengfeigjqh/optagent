/**
 * 内置工具目录路由（`contracts/admin-api.md` §2.1）。
 *
 * **只读投影**：数据来源是运行环境（`FR-011`），平台 MUST NOT 持久化副本、
 * MUST NOT 由调用方硬编码（`SC-013`）。
 *
 * 关键约束（`FR-012`、`SC-014`）：`description_template` MUST 保持
 * **占位符模板**形态，MUST NOT 替换为任何具体用户目录名或会话标识——
 * 因此本路由**原样透传**运行环境返回值，不做任何渲染。
 */
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
