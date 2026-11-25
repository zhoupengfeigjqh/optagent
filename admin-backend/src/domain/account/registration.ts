/**
 * 注册编排（028 §4.1）：专属链接 → 手机号注册 → 自动授权。
 *
 * 事务口径：
 * - mysql 驱动下由 `users` 表唯一键（`uk_users_phone`）兜底并发注册；
 * - file 驱动为顺序写（与 024 同口径，不引入文件锁）；
 * - 失败 midway（建用户成功、授权失败）时**回滚已建用户**，避免半截账号。
 *
 * 注册**不自动登录**（D7，与原型一致）；注册成功只写 `user_agent_grants(approved)`，
 * **不写** `users.agents[]`（方案 §6：授权 ≠ 部署，部署仍走既有流程）。
 */
import { randomBytes } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import {
  isPasswordLengthValid,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '../auth/password.js';
import {
  normalizeDisplayName,
  normalizePhone,
  type UserLinkPort,
} from '../config-center/user-links.js';
import { nowDatetime, type AccountStorePort, type GrantRecord } from './account-store.js';
import type { RegisterLinkService } from './register-links.js';

export interface RegisterInput {
  linkToken: string;
  phone: unknown;
  displayName: unknown;
  password: unknown;
}

export interface RegisterResult {
  user_id: string;
  phone: string;
  display_name: string;
  granted_agent: { code: string; name: string };
}

export class RegistrationService {
  constructor(
    private readonly users: UserLinkPort,
    private readonly store: AccountStorePort,
    private readonly links: RegisterLinkService,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    // 1. 链接校验（无效/过期/撤销/停用 → ADM_INVALID_LINK，不枚举）
    if (typeof input.linkToken !== 'string' || input.linkToken.trim() === '') {
      throw new ApiError(ERROR_CODES.ADM_INVALID_LINK, '注册链接无效或已过期');
    }
    const { agent } = await this.links.lookup(input.linkToken.trim());

    // 2. 字段校验
    const phone = normalizePhone(input.phone);
    if (phone === null) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '手机号必填（1 开头的 11 位数字）');
    }
    const displayName = normalizeDisplayName(input.displayName);
    if (displayName === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '用户名必填（2~64 个字符）');
    }
    const password = typeof input.password === 'string' ? input.password : '';
    if (!isPasswordLengthValid(password)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `密码长度须为 ${PASSWORD_MIN_LENGTH}~${PASSWORD_MAX_LENGTH} 个字符`,
      );
    }

    // 3. 手机号占用预检（mysql 下并发注册由 uk_users_phone 兜底）
    if (this.users.findByPhone(phone)) {
      throw new ApiError(ERROR_CODES.ADM_PHONE_TAKEN, `手机号已被注册：${phone}`);
    }

    // 4. 建用户（user_id 服务端生成：u_ + 12 位十六进制，D2）
    const userId = this.generateUserId();
    try {
      await this.users.create(userId, [], undefined, password, {
        phone,
        display_name: displayName,
        role: 'user',
        source_agent_code: agent.code,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === ERROR_CODES.ADM_PHONE_TAKEN) throw err;
      if (err instanceof ApiError && err.code === ERROR_CODES.ADM_USER_ID_TAKEN) {
        // 极小概率撞号：重试一次
        const retry = this.generateUserId();
        await this.users.create(retry, [], undefined, password, {
          phone,
          display_name: displayName,
          role: 'user',
          source_agent_code: agent.code,
        });
        return this.finalize(retry, phone, displayName, agent.code, agent.name, input.linkToken.trim());
      }
      throw err;
    }
    return this.finalize(userId, phone, displayName, agent.code, agent.name, input.linkToken.trim());
  }

  private async finalize(
    userId: string,
    phone: string,
    displayName: string,
    agentCode: string,
    agentName: string,
    token: string,
  ): Promise<RegisterResult> {
    const now = nowDatetime();
    const grant: GrantRecord = {
      user_id: userId,
      agent_code: agentCode,
      status: 'approved',
      source: 'register_link',
      reviewed_by: null,
      reviewed_at: null,
      created_at: now,
      updated_at: now,
    };
    try {
      // 5. 注册即授权（approved）+ 链接计数
      await this.store.saveGrant(grant);
      await this.links.consume(token);
    } catch (err) {
      // 回滚已建用户，避免"有账号无授权"的半截状态
      await this.users.remove(userId).catch(() => undefined);
      throw err;
    }
    return {
      user_id: userId,
      phone,
      display_name: displayName,
      granted_agent: { code: agentCode, name: agentName },
    };
  }

  /** `u_` + 12 位小写十六进制（D2；`isSafeName` 天然通过，不与存量 admin 等冲突） */
  private generateUserId(): string {
    return `u_${randomBytes(6).toString('hex')}`;
  }
}
