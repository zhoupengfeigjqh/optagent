/**
 * 术语替换预检（018）：`POST /api/term-normalize`。
 *
 * 为什么在**发送前单独一次调用**，而不是在发消息链路里静默改写：
 * 用户必须能在"替换后"和"原话"之间选一次（需求 4）。发送链路本身因此只有一种输入，
 * 历史/摘要/意图聚焦看到的都是用户最终确认的那一版，不存在"同一句话两个版本"的歧义。
 *
 * 本端点职责很薄——**只做编排**：开关判定、读表、调匹配、组响应。
 * 口径与算法分别在 `domain/term-normalize/{tables,matcher}.ts`：
 * - 027：闸门 = 「意图聚焦」**且**「术语替换」两个 SOUL 开关（都在 `soul.ts`，
 *   fail-closed、逐次读盘）。018 时期"意图聚焦即替换"已废止：升级后需管理员
 *   显式开启术语替换并重新部署，否则表现为"替换不见了"（见部署说明）；
 * - 本路由是该闸门的**唯一**判定点（前端零改动）；
 * - 关闭 / 无字典 / 读表失败 → `applied:false`，前端直接按原话发送，用户无感。
 *
 * 归属数字人取服务端"当前选中数字人"（与其余请求同源），客户端不能指定。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { getCurrentUser } from '../domain/current-user.js';
import { agentDir } from '../domain/dirs.js';
import { isIntentFocusEnabled, isTermNormalizeEnabled } from '../domain/soul.js';
import { normalizeByTerms, type TermMatch } from '../domain/term-normalize/matcher.js';
import { loadTermTable } from '../domain/term-normalize/tables.js';
import { ApiError } from '../server.js';

const termNormalizeBodySchema = {
  type: 'object',
  required: ['content'],
  additionalProperties: false,
  properties: {
    // 上限与输入区一致即可；替换本身是 O(n × 最长术语长度)，不需要额外业务限制
    content: { type: 'string', minLength: 1 },
  },
} as const;

/** 允许的字段（与 schema 同源，避免两处清单漂移） */
const BODY_KEYS = new Set(Object.keys(termNormalizeBodySchema.properties));

/**
 * 严格校验：默认 ajv 的 `removeAdditional: true` 会把拼错的字段**静默丢掉**。
 * 对替换预检来说，"把 `content` 写错成 `text` 却返回未替换"是最难排查的失败，
 * 因此与发消息路由同口径：未知字段直接 400。
 */
function assertStrictBody(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const unknown = Object.keys(body).filter((key) => !BODY_KEYS.has(key));
  if (unknown.length > 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', `不支持的请求字段: ${unknown.join(', ')}`);
  }
}

export interface TermNormalizeResponse {
  /** 是否真的发生了改变（`value === term` 的"替换成自己"不算） */
  applied: boolean;
  original: string;
  normalized: string;
  matches: TermMatch[];
}

export function registerTermNormalizeRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/term-normalize',
    {
      schema: { body: termNormalizeBodySchema },
      preValidation: async (req) => assertStrictBody(req.body),
    },
    async (req): Promise<TermNormalizeResponse> => {
      const userId = getCurrentUser().userId;
      const { agentName } = resolveAgentScope(ctx, userId, {
        notSelectedMessage: '请先选定数字人再进行术语替换',
        route: 'POST /api/term-normalize',
      });
      const { content } = req.body as { content: string };
      const unchanged: TermNormalizeResponse = {
        applied: false,
        original: content,
        normalized: content,
        matches: [],
      };

      // 027：闸门改为「意图聚焦 && 术语替换」——任一关闭都不读术语文件（零 IO、零弹窗）。
      // 顺序刻意先读意图聚焦：它关闭时绝大多数请求在这一步就返回，省掉第二次读盘。
      const gateLogger = {
        warn: (msg: string) =>
          ctx.loggers.logger.warn(
            { event: 'term_normalize.gate', user_id: userId, agent_name: agentName },
            msg,
          ),
      };
      const enabled =
        isIntentFocusEnabled(ctx.config.optAgentRoot, userId, agentName, gateLogger) &&
        isTermNormalizeEnabled(ctx.config.optAgentRoot, userId, agentName, gateLogger);
      if (!enabled) return unchanged;

      const loaded = loadTermTable(agentDir(ctx.config.optAgentRoot, userId, agentName));
      if (loaded.warnings.length > 0) {
        // 术语表是增强件：坏一个本体不阻断其余本体，也不阻断发送
        ctx.loggers.logger.warn(
          {
            event: 'term_normalize.degraded',
            user_id: userId,
            agent_name: agentName,
            warnings: loaded.warnings,
          },
          '部分术语表不可用，按可用部分替换',
        );
      }
      if (loaded.files === 0) return unchanged;

      const result = normalizeByTerms(content, loaded.table);
      return {
        applied: result.applied,
        original: content,
        normalized: result.normalized,
        matches: result.matches,
      };
    },
  );
}
