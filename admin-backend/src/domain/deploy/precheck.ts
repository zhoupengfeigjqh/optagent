/**
 * 部署前校验（`FR-027`、`FR-057`、`SC-020`，`data-model.md` §7.2）。
 *
 * 三条硬性口径：
 * 1. **只读**——在任何写入发生**之前**执行；
 * 2. **一次性列出全部错误项**（不是发现一个就停），每条可定位到
 *    具体的用户、数字人与配置类别；
 * 3. **校验所需信息读取不到时按失败处理**，MUST NOT 视为通过
 *    （否则"读不到"会伪装成"没问题"）。
 *
 * 五类校验项：
 * | # | 类别 | 内容 |
 * |---|---|---|
 * | ① | `config_integrity` | SOUL 非空；五类配置无缺字段 |
 * | ② | `reference_validity` | 三类引用均存在于统一清单 |
 * | ③ | `name_path_safety` | 数字人名、用户标识不含路径分隔符或 `..` |
 * | ④ | `target_writable` | 目标位置可写 |
 * | ⑤ | `runtime_form` | 每个被引用 MCP 服务在**目标运行形态**下有地址 |
 */
import { ERROR_CODES } from '../error-codes.js';
import { detectAnomalies } from '../config-center/references.js';
import type { AgentDesignDocument } from '../config-center/agent-design.js';
import { isSafeName } from '../config-center/naming.js';
import { scenarioFieldIssues } from '../config-center/scenario.js';
import type { ReferenceIndex } from '../config-center/reference-index.js';
import type { RuntimeForm } from '../platform-settings.js';

export type PrecheckCategory =
  | 'config_integrity'
  | 'reference_validity'
  | 'name_path_safety'
  | 'target_writable'
  | 'runtime_form';

export interface PrecheckError {
  user_id: string;
  agent_name: string;
  category: PrecheckCategory;
  code: string;
  message: string;
  detail?: string;
}

export interface PrecheckUser {
  user_id: string;
  agents: string[];
}

export interface PrecheckInput {
  users: PrecheckUser[];
  /** 读取数字人设计态；不存在返回 `null` */
  readDesign(name: string): AgentDesignDocument | null;
  index: ReferenceIndex;
  /** 内置工具目录不可得的原因（非 `null` 即"信息读取不到"） */
  toolsUnavailableReason: string | null;
  runtimeForm: RuntimeForm;
  /** 目标运行形态下的连接地址；缺该形态返回 `null` */
  endpointFor(serviceName: string): string | null;
  /** 目标目录是否可写（注入以便单测；缺省用 fs 探测） */
  isWritable(userId: string): boolean;
}

export function runPrecheck(input: PrecheckInput): PrecheckError[] {
  const errors: PrecheckError[] = [];

  for (const user of input.users) {
    // ③ 命名与路径安全：用户标识先行（否则无法定位到合法目标路径）
    if (!isSafeName(user.user_id)) {
      errors.push({
        user_id: user.user_id,
        agent_name: '',
        category: 'name_path_safety',
        code: ERROR_CODES.VALIDATION_FAILED,
        message: `用户标识非法（不可作目录名）：${user.user_id}`,
      });
      continue;
    }

    // ④ 目标可写
    if (!input.isWritable(user.user_id)) {
      errors.push({
        user_id: user.user_id,
        agent_name: '',
        category: 'target_writable',
        code: ERROR_CODES.ADM_DEPLOY_TARGET_NOT_WRITABLE,
        message: `部署目标不可写：users/${user.user_id}/agents/`,
      });
    }

    for (const agentName of user.agents) {
      if (!isSafeName(agentName)) {
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'name_path_safety',
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `数字人名称非法（不可作目录名）：${agentName}`,
        });
        continue;
      }

      const design = input.readDesign(agentName);
      if (!design) {
        // 关联了不存在的数字人：属配置完整性问题，按失败处理
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'config_integrity',
          code: ERROR_CODES.ADM_AGENT_NOT_FOUND,
          message: `用户 ${user.user_id} 关联的数字人 ${agentName} 不存在（设计态缺失）`,
        });
        continue;
      }

      // ① 配置完整性
      if (typeof design.soul !== 'string' || design.soul.trim() === '') {
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'config_integrity',
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `数字人 ${agentName} 的 SOUL 为空`,
        });
      }
      for (const field of ['enabled_tools', 'mcp_services', 'skills'] as const) {
        if (!Array.isArray(design[field])) {
          errors.push({
            user_id: user.user_id,
            agent_name: agentName,
            category: 'config_integrity',
            code: ERROR_CODES.VALIDATION_FAILED,
            message: `数字人 ${agentName} 的 ${field} 字段缺失或类型不合法`,
          });
        }
      }
      if (
        !design.scenario ||
        typeof design.scenario.scenario !== 'string' ||
        design.scenario.scenario.trim() === '' ||
        !Array.isArray(design.scenario.data_prep_dirs)
      ) {
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'config_integrity',
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `数字人 ${agentName} 的文件空间场景配置不完整`,
        });
      }
      // 场景字段约束：手工改过设计态文件 / 旧文档的情况在这里兜底
      // （不与上面的"整体不完整"重复判定：形状合法才逐项校验）
      if (design.scenario && Array.isArray(design.scenario.data_prep_dirs)) {
        for (const issue of scenarioFieldIssues(design.scenario)) {
          errors.push({
            user_id: user.user_id,
            agent_name: agentName,
            category: 'config_integrity',
            code: ERROR_CODES.VALIDATION_FAILED,
            message: `数字人 ${agentName} 的场景字段约束非法：${issue}`,
          });
        }
      }

      // ② 引用有效性（信息读取不到即按失败处理）
      if (input.toolsUnavailableReason && (design.enabled_tools ?? []).length > 0) {
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'reference_validity',
          code: ERROR_CODES.ADM_RUNTIME_UNREACHABLE,
          message: `无法读取内置工具目录，无法判定 ${agentName} 的工具引用是否有效`,
          detail: input.toolsUnavailableReason,
        });
      } else {
        for (const anomaly of detectAnomalies(
          {
            name: design.name,
            enabled_tools: design.enabled_tools ?? [],
            mcp_services: design.mcp_services ?? [],
            skills: design.skills ?? [],
          },
          input.index,
        )) {
          errors.push({
            user_id: user.user_id,
            agent_name: agentName,
            category: 'reference_validity',
            code: ERROR_CODES.ADM_AGENT_INVALID_REF,
            message: anomaly.detail,
            detail: anomaly.target_name,
          });
        }
      }

      // ⑤ 运行形态地址齐备（FR-056 / FR-057）
      for (const serviceName of design.mcp_services ?? []) {
        if (input.endpointFor(serviceName) === null) {
          errors.push({
            user_id: user.user_id,
            agent_name: agentName,
            category: 'runtime_form',
            code: ERROR_CODES.ADM_RUNTIME_FORM_NOT_CONFIGURED,
            message:
              `MCP 服务 ${serviceName} 缺少目标运行形态（${input.runtimeForm}）的连接地址，` +
              `已阻止部署（不会回退到其他形态的地址）`,
            detail: serviceName,
          });
        }
      }
    }
  }

  return errors;
}

/** 是否有错误（`passed` 的等价判定） */
export function precheckPassed(errors: PrecheckError[]): boolean {
  return errors.length === 0;
}
