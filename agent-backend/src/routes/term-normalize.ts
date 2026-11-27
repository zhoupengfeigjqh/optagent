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

function assertStrictBody(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return;
  const unknown = Object.keys(body).filter((key) => !BODY_KEYS.has(key));
  if (unknown.length > 0) {
    throw new ApiError(400, 'VALIDATION_FAILED', `不支持的请求字段: ${unknown.join(', ')}`);
  }
}

export interface TermNormalizeResponse {
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
