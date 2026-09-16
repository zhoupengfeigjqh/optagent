/**
 * 内置工具目录端点（`plan.md` R2，`contracts/runtime-api-delta.md` §2）。
 *
 * `GET /api/builtin-tools` —— 向管理平台提供**可枚举的内置工具目录**
 * （`FR-011` 的唯一来源）。平台只做只读投影，MUST NOT 硬编码一份副本
 * （`FR-011`、`FR-012`、`SC-013`）。
 *
 * **只读端点**，无副作用、无请求体、无鉴权（沿用运行环境既有口径）。
 * `description_template` MUST 保持**占位符形态**（`SC-014`）——因此这里
 * 直接返回目录原文，**不做任何渲染**。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { listBuiltinTools } from '../domain/builtin-tool-catalog.js';

export function registerBuiltinToolRoutes(app: FastifyInstance, _ctx: AppContext): void {
  app.get('/api/builtin-tools', async () => {
    const items = listBuiltinTools();
    return { items, total: items.length };
  });
}
