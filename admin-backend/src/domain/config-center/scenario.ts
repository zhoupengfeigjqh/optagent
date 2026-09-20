/**
 * 文件空间场景（`FR-020`）：场景名 + 数据准备二级目录清单 + **字段约束**。
 *
 * 字段约束（`data_prep_fields`）声明"该目录的上传表必须有哪些表头、各是什么类型"，
 * 供**上传时**由运行环境按表头预检（本期只落配置，不实现校验链路）。
 *
 * 两个出口同一判据：
 * - `normalizeScenario`：保存路径，**严格**——第一条错误即抛（设计态是平台的权威源，
 *   错误 MUST 在保存时暴露，而不是静默归一化）；
 * - `scenarioFieldIssues`：部署前校验路径，**收集全部**问题（`FR-027` 要求
 *   一次性列出全部错误项，且"读不到/看不懂"按失败处理）。
 *
 * 判据集中在本模块，避免"保存能过、部署被拒"这类两侧分叉。
 */
import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { isSafeDirName, isSafeName } from './naming.js';

/**
 * 字段取值类型（JSON Schema 基本类型的子集）。
 *
 * 与运行环境（`agent-backend` `SCENARIO_FIELD_TYPES`）、管理界面（`admin-frontend`）
 * **同一枚举**，三处 MUST 同步（契约 `admin-api.md` §5.2、`runtime-api-delta.md` §3.1）。
 */
export const SCENARIO_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
] as const;
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number];

/** 单个数据准备目录的字段约束上限（防滥用，与 `UPLOAD_MAX_MB` 同类的边界治理） */
export const MAX_FIELDS_PER_DIR = 50;

/**
 * 「数据准备」预定义二级目录（平台硬编码）。
 *
 * 场景清单 MUST 包含该目录：保存时缺失即拒（`normalizeScenario`），部署前校验对
 * **手工改过的设计态文档**兜底（`scenarioFieldIssues`）。界面渲染为锁定行
 * （不可移除），见 `admin-frontend` `constants/agent-design.ts` 的同名常量
 * （两处 MUST 同步）。预定义目录**不强制字段约束**——0 条字段 = 无约束。
 */
export const PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const;

/** 清单缺失的预定义目录（两个校验出口共用同一判据） */
export function missingPredefinedDirs(dirs: readonly string[]): string[] {
  return PREDEFINED_DATA_PREP_DIRS.filter((dir) => !dirs.includes(dir));
}

/** 数据准备目录的上传表字段约束 */
export interface ScenarioField {
  /** 字段名（＝上传表的表头名）；非空、≤64 字符、不含路径分隔符或 `..`、同目录内唯一 */
  name: string;
  type: ScenarioFieldType;
  /** 必填：上传表的表头 MUST 包含该字段；`false` 为可选（出现则类型仍须匹配） */
  required: boolean;
}

export interface AgentScenario {
  scenario: string;
  data_prep_dirs: string[];
  /**
   * 目录 → 字段约束（MUST NOT 内嵌上传数据本身，只声明结构）。
   *
   * 只保存**有字段**的目录（空清单不出现）；清单外的目录名即拒。
   * 类型上可选仅为兼容本字段引入前的历史设计态文档——读取路径一律经
   * `scenarioFields()` 归一化，因此**对外契约恒有该键**。
   */
  data_prep_fields?: Record<string, ScenarioField[]>;
}

/** 归一化读取：历史文档缺 `data_prep_fields` 时按"无字段约束"处理 */
export function scenarioFields(
  scenario: AgentScenario | null | undefined,
): Record<string, ScenarioField[]> {
  const fields = scenario?.data_prep_fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return fields;
}

/** 场景：名称非空；目录清单拒绝空值 / 重复 / 含分隔符 / `..`（`FR-020`） */
export function normalizeScenario(raw: unknown): AgentScenario {
  const obj = (raw ?? {}) as {
    scenario?: unknown;
    data_prep_dirs?: unknown;
    data_prep_fields?: unknown;
  };
  const scenario = typeof obj.scenario === 'string' ? obj.scenario.trim() : '';
  if (scenario === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '文件空间场景名必填且不能为空（FR-020）');
  }
  if (!isSafeName(scenario)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `场景名非法：${scenario}（不得含路径分隔符或 ".."）`,
    );
  }
  if (!Array.isArray(obj.data_prep_dirs)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      '数据准备二级目录清单须为数组（可为空数组，但 MUST NOT 缺字段）',
    );
  }
  const dirs: string[] = [];
  for (const item of obj.data_prep_dirs) {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '数据准备二级目录清单含空值');
    }
    if (!isSafeDirName(item)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `数据准备二级目录名非法：${item}（不得含路径分隔符或 ".."）`,
      );
    }
    if (dirs.includes(item)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `数据准备二级目录重复：${item}`);
    }
    dirs.push(item);
  }
  const missing = missingPredefinedDirs(dirs);
  if (missing.length > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `缺少预定义二级目录：${missing.join('、')}（预定义目录不可移除）`,
    );
  }
  return {
    scenario,
    data_prep_dirs: dirs,
    data_prep_fields: normalizeScenarioFields(obj.data_prep_fields, dirs),
  };
}

/**
 * 场景字段约束（保存时**严格**校验）。
 *
 * - 整体须为对象；目录名必须在目录清单内（孤儿约束 = 错误，不是可忽略的冗余）；
 * - 字段名复用 `isSafeDirName`（非空、≤64、无分隔符 / `..` / 控制字符），同目录内唯一；
 * - 类型限 `SCENARIO_FIELD_TYPES`；`required` MUST 显式为布尔（不给隐式默认，避免歧义）；
 * - 每目录字段数 ≤ `MAX_FIELDS_PER_DIR`。
 *
 * 边界：**空清单的目录不写入结果**——"缺失"即"无字段约束"，不留空数组空壳
 * （界面上点「保存」但未加任何字段 = 该目录不受约束）。
 */
function normalizeScenarioFields(
  raw: unknown,
  dirs: readonly string[],
): Record<string, ScenarioField[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      '数据准备字段约束须为对象（目录名 → 字段清单）',
    );
  }

  const out: Record<string, ScenarioField[]> = {};
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `字段约束引用了数据准备目录清单外的目录：${dir}`,
      );
    }
    if (!Array.isArray(value)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `目录 ${dir} 的字段清单须为数组`);
    }
    if (value.length > MAX_FIELDS_PER_DIR) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `目录 ${dir} 的字段数超过上限 ${MAX_FIELDS_PER_DIR}`,
      );
    }

    const list: ScenarioField[] = [];
    for (const item of value) {
      const field = (item ?? {}) as { name?: unknown; type?: unknown; required?: unknown };
      const fieldName = field.name;
      if (typeof fieldName !== 'string' || !isSafeDirName(fieldName)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `目录 ${dir} 的字段名非法：${JSON.stringify(fieldName)}（不得为空、不得含路径分隔符或 ".."，且不超过 64 字符）`,
        );
      }
      if (list.some((f) => f.name === fieldName)) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `目录 ${dir} 的字段名重复：${fieldName}`);
      }
      if (!SCENARIO_FIELD_TYPES.includes(field.type as ScenarioFieldType)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `字段 ${fieldName} 的取值类型非法：${JSON.stringify(field.type)}（仅支持 ${SCENARIO_FIELD_TYPES.join(' / ')}）`,
        );
      }
      if (typeof field.required !== 'boolean') {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `字段 ${fieldName} 的 required 须为布尔值（true = 表头必含）`,
        );
      }
      list.push({
        name: fieldName,
        type: field.type as ScenarioFieldType,
        required: field.required,
      });
    }

    if (list.length > 0) out[dir] = list;
  }
  return out;
}

/**
 * 场景字段约束的**问题清单**（不抛错，供部署前校验一次性列出全部错误）。
 *
 * 覆盖两种来源：手工改过设计态文件，以及本字段引入前的历史文档被外部修改。
 */
export function scenarioFieldIssues(scenario: AgentScenario | null | undefined): string[] {
  if (!scenario || !Array.isArray(scenario.data_prep_dirs)) return [];
  const dirs = scenario.data_prep_dirs;
  // 预定义目录缺失是独立判据：fields 缺省的历史文档也必须报告（先于 fields 的缺省早退）
  const issues: string[] = missingPredefinedDirs(dirs).map((dir) => `缺少预定义二级目录：${dir}`);
  const fields = scenario.data_prep_fields;
  if (fields === undefined || fields === null) return issues;
  if (typeof fields !== 'object' || Array.isArray(fields)) {
    return [...issues, '字段约束（data_prep_fields）须为对象'];
  }

  for (const [dir, value] of Object.entries(fields as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      issues.push(`字段约束引用了目录清单外的目录：${dir}`);
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`目录 ${dir} 的字段清单须为数组`);
      continue;
    }
    if (value.length > MAX_FIELDS_PER_DIR) {
      issues.push(`目录 ${dir} 的字段数超过上限 ${MAX_FIELDS_PER_DIR}`);
    }
    const seen = new Set<string>();
    for (const item of value) {
      const field = (item ?? {}) as { name?: unknown; type?: unknown; required?: unknown };
      if (typeof field.name !== 'string' || !isSafeDirName(field.name)) {
        issues.push(`目录 ${dir} 含非法字段名：${JSON.stringify(field.name)}`);
        continue;
      }
      if (seen.has(field.name)) {
        issues.push(`目录 ${dir} 的字段名重复：${field.name}`);
        continue;
      }
      seen.add(field.name);
      if (!SCENARIO_FIELD_TYPES.includes(field.type as ScenarioFieldType)) {
        issues.push(`字段 ${field.name} 的取值类型非法：${JSON.stringify(field.type)}`);
      }
      if (typeof field.required !== 'boolean') {
        issues.push(`字段 ${field.name} 的 required 须为布尔值`);
      }
    }
  }
  return issues;
}
