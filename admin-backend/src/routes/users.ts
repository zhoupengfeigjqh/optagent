/**
 * 用户与关联数字人路由（`contracts/admin-api.md` §6.1~§6.4）。
 *
 * 该页兼作**部署前核对总账**（`FR-023`）：用户卡片可展开看到每个数字人的
 * 搭配摘要（引用的 MCP 服务、内置工具、SKILL）及其异常标记，
 * 并在卡片上显示**部署状态**（`deployed_at`，取自部署清单；`null` = 尚未部署）。
 * 部署对象就在这一页勾选（2026-09-16 十一次调整）。
 *
 * `DELETE`（2026-10-20 修订）：**先撤回该用户的部署**（清 `agents/**`、移出清单），
 * 再删平台侧记录。文件空间（`user-data/**`）一律保留（`FR-028`）。
 *
 * 顺序不能颠倒：撤回失败时用户仍在平台，管理员可重试；若先删平台记录，就再没有
 * 入口能把该用户从运行环境清掉——遗留的部署会继续对外提供服务。
 */
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { ApiError } from '../domain/api-error.js';
import {
  isPasswordLengthValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../domain/auth/password.js';
import { anomalyReason, detectAnomalies } from '../domain/config-center/references.js';
import {
  normalizeDisplayName,
  normalizePhone,
  normalizeRole,
} from '../domain/config-center/user-links.js';
import { ERROR_CODES } from '../domain/error-codes.js';
import { normalizePage } from '../domain/paging.js';

export function registerUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  async function resolveIndex() {
    return (await ctx.catalog.snapshot()).index;
  }

  app.get('/api/admin/users', async (req) => {
    const query = (req.query ?? {}) as { page?: unknown };
    const page = normalizePage(query.page);
    const index = await resolveIndex();

    return ctx.users.list(page, (user) => {
      const agents = user.agents.map((name) => {
        const design = ctx.agents.readOrNull(name);
        if (!design) {
          return { name, abnormal: true, abnormal_reason: `数字人 ${name} 的设计态缺失` };
        }
        const anomalies = detectAnomalies(design, index);
        return { name, abnormal: anomalies.length > 0, abnormal_reason: anomalyReason(anomalies) };
      });

      return {
        user_id: user.user_id,
        agents,
        // 部署状态取自部署清单：`null` 表示"从未部署过"（新建用户即如此）
        deployed_at: ctx.manifest.get(user.user_id)?.last_deployed_at ?? null,
        // 028：账号扩展字段（存量用户为 null / user）
        phone: user.phone ?? null,
        display_name: user.display_name ?? null,
        role: user.role ?? 'user',
        source_agent_code: user.source_agent_code ?? null,
        // 2026-11-27：`expand=summary` 已移除——它唯一的消费方「部署前核对总账」随部署区下架，
        // 前端也不再请求；授权数即 `agents.length`，卡片不需要第二份摘要。
      };
    });
  });

  app.post('/api/admin/users', async (req, reply) => {
    const body = (req.body ?? {}) as {
      user_id?: unknown;
      agents?: unknown;
      revision?: unknown;
      password?: unknown;
      phone?: unknown;
      display_name?: unknown;
      role?: unknown;
    };
    assertAgentsExist(ctx, body.agents);
    // 024：新建用户可设初始密码（缺省 = 不设，视为不可登录的存量口径）
    let password: string | undefined;
    if (body.password !== undefined && body.password !== null && body.password !== '') {
      if (
        typeof body.password !== 'string' ||
        body.password.length < PASSWORD_MIN_LENGTH ||
        body.password.length > PASSWORD_MAX_LENGTH
      ) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`,
        );
      }
      password = body.password;
    }
    // 028：账号扩展字段（可选；形态不合法即 400）
    const profile = {
      phone: normalizePhone(body.phone),
      display_name: normalizeDisplayName(body.display_name),
      role: normalizeRole(body.role),
    };
    const revision = typeof body.revision === 'number' ? body.revision : undefined;
    const view = await ctx.users.create(body.user_id, body.agents, revision, password, profile);
    return reply.status(201).send(view);
  });

  app.put('/api/admin/users/:user_id', async (req) => {
    const { user_id: userId } = req.params as { user_id: string };
    const body = (req.body ?? {}) as { agents?: unknown; revision?: unknown };
    if (typeof body.revision !== 'number' || !Number.isInteger(body.revision)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, 'revision 必填且须为整数（乐观锁）');
    }
    assertAgentsExist(ctx, body.agents);
    return await ctx.users.update(userId, body.agents, body.revision);
  });

  /**
   * 重置密码（2026-11-18，契约 §6.4.1）。
   *
   * 独立子资源而非并入 `PUT /api/admin/users/{uid}`：后者带 `revision` 且语义是
   * "替换关联数字人"，把密码塞进去会让两条无关的写入互相拖累版本。这里**不带**乐观锁。
   *
   * 重置成功即撤销该用户的会话（`FR-012` 同口径）：旧凭据里登记的是旧会话，
   * 不改密码就换会话等于没收回，故必须先清登记再返回。
   */
  app.post('/api/admin/users/:user_id/password', async (req) => {
    const { user_id: userId } = req.params as { user_id: string };
    const body = (req.body ?? {}) as { password?: unknown };
    const password = body.password;
    if (typeof password !== 'string' || !isPasswordLengthValid(password)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`,
      );
    }
    const view = await ctx.users.setPassword(userId, password);
    await ctx.auth.revokeUser(userId);
    return view;
  });

  app.delete('/api/admin/users/:user_id', async (req, reply) => {
    const { user_id: userId } = req.params as { user_id: string };
    // 不存在 → 404（先读一次，避免对未知目录做写操作）
    ctx.users.read(userId);
    // 撤回能力（清运行环境 `agents/**` + 移出部署清单）→ 再删平台记录
    ctx.deployer.purgeUser(userId);
    // 2026-11-27：授权 = 关联，随用户记录一并删除（旧的 grants 记录保留作历史审计）
    await ctx.users.remove(userId);
    // 024：删除用户即清除其会话登记（旧凭据即时失效，FR-012）
    await ctx.auth.revokeUser(userId);
    return reply.status(204).send();
  });
}

/** `FR-025`：可关联的 MUST 是平台内**已存在**的数字人 */
function assertAgentsExist(ctx: AppContext, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  const missing = raw.filter((name): name is string => typeof name === 'string' && !ctx.agents.exists(name));
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `关联了不存在的数字人：${missing.join('、')}（可关联的只能是平台内已存在的数字人）`,
    );
  }
}
