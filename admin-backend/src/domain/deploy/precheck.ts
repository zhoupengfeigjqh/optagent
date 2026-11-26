import { ERROR_CODES } from '../error-codes.js';
import { detectAnomalies } from '../config-center/references.js';
import type { AgentDesignDocument } from '../config-center/agent-design.js';
import { isSafeName } from '../config-center/naming.js';
import { scenarioFieldIssues, scenarioUploadIssues } from '../config-center/scenario.js';
import type { ReferenceIndex } from '../config-center/reference-index.js';

export type PrecheckCategory =
  'config_integrity' | 'reference_validity' | 'name_path_safety' | 'target_writable';

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
  readDesign(name: string): AgentDesignDocument | null;
  index: ReferenceIndex;
  /** 内置工具目录不可得的原因（非 `null` 即"信息读取不到"） */
  toolsUnavailableReason: string | null;
  isWritable(userId: string): boolean;
  ontologyIssue?(ontologyRef: string): string | null;
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
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'config_integrity',
          code: ERROR_CODES.ADM_AGENT_NOT_FOUND,
          message: `用户 ${user.user_id} 关联的数字人 ${agentName} 不存在（设计态缺失）`,
        });
        continue;
      }

      if (!design.soul || typeof design.soul.mission !== 'string' || design.soul.mission.trim() === '') {
        errors.push({
          user_id: user.user_id,
          agent_name: agentName,
          category: 'config_integrity',
          code: ERROR_CODES.VALIDATION_FAILED,
          message: `数字人 ${agentName} 的 SOUL 为空`,
        });
      }
      for (const field of ['enabled_tools', 'mcp_services', 'skills', 'ontologies'] as const) {
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
        for (const issue of scenarioUploadIssues(design.scenario)) {
          errors.push({
            user_id: user.user_id,
            agent_name: agentName,
            category: 'config_integrity',
            code: ERROR_CODES.VALIDATION_FAILED,
            message: `数字人 ${agentName} 的可上传类型配置非法：${issue}`,
          });
        }
      }

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
            ontologies: design.ontologies ?? [],
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

        for (const ref of design.ontologies ?? []) {
          if (!input.index.ontologies.has(ref)) continue;
          const issue = input.ontologyIssue?.(ref) ?? null;
          if (issue !== null) {
            errors.push({
              user_id: user.user_id,
              agent_name: agentName,
              category: 'reference_validity',
              code: ERROR_CODES.ADM_ONTOLOGY_NOT_FOUND,
              message: `本体 ${ref} 的文件不完整，无法部署`,
              detail: issue,
            });
          }
        }
      }
    }
  }

  return errors;
}

export function precheckPassed(errors: PrecheckError[]): boolean {
  return errors.length === 0;
}
