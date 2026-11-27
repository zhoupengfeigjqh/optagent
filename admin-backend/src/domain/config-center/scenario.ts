import { ApiError } from '../api-error.js';
import { ERROR_CODES } from '../error-codes.js';
import { isSafeDirName, isSafeName } from './naming.js';

export const SCENARIO_FIELD_TYPES = ['string', 'integer', 'number', 'boolean', 'object', 'array'] as const;
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number];

/** 单个数据准备目录的字段约束上限（防滥用，与 `UPLOAD_MAX_MB` 同类的边界治理） */
export const MAX_FIELDS_PER_DIR = 50;

export const DATA_PREP_UPLOAD_EXTS = [
  '.xlsx',
  '.xls',
  '.csv',
  '.txt',
  '.pdf',
  '.json',
  '.html',
  '.zip',
  '.jpg',
  '.png',
  '.jpeg',
] as const;
export type DataPrepUploadExt = (typeof DATA_PREP_UPLOAD_EXTS)[number];

export const PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const;

export interface ScenarioField {
  name: string;
  type: ScenarioFieldType;
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
  data_prep_uploads?: Record<string, string[]>;
}

export function scenarioFields(scenario: AgentScenario | null | undefined): Record<string, ScenarioField[]> {
  const fields = scenario?.data_prep_fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return {};
  return fields;
}

export function scenarioUploads(
  scenario: AgentScenario | null | undefined,
): Record<string, string[]> | undefined {
  const uploads = scenario?.data_prep_uploads;
  if (!uploads || typeof uploads !== 'object' || Array.isArray(uploads)) return undefined;
  return uploads;
}

export function normalizeScenario(raw: unknown): AgentScenario {
  const obj = (raw ?? {}) as {
    scenario?: unknown;
    data_prep_dirs?: unknown;
    data_prep_fields?: unknown;
    data_prep_uploads?: unknown;
  };
  const scenario = typeof obj.scenario === 'string' ? obj.scenario.trim() : '';
  if (scenario === '') {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '文件空间场景名必填且不能为空（FR-020）');
  }
  if (!isSafeName(scenario)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `场景名非法：${scenario}（不得含路径分隔符或 ".."）`);
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
  // 预定义目录**可被屏蔽**（2026-11-17）：清单里没有它 = 该目录对数字人不可见，
  return {
    scenario,
    data_prep_dirs: dirs,
    data_prep_fields: normalizeScenarioFields(obj.data_prep_fields, dirs),
    data_prep_uploads: normalizeScenarioUploads(obj.data_prep_uploads, dirs),
  };
}

function normalizeScenarioUploads(raw: unknown, dirs: readonly string[]): Record<string, string[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '可上传文件类型须为对象（目录名 → 扩展名清单）');
  }

  const out: Record<string, string[]> = {};
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `可上传文件类型引用了数据准备目录清单外的目录：${dir}`,
      );
    }
    if (!Array.isArray(value)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `目录 ${dir} 的可上传类型须为数组`);
    }
    const allowed = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `目录 ${dir} 的可上传类型含非法项：${JSON.stringify(item)}`,
        );
      }
      const ext = item.trim().toLowerCase();
      if (!(DATA_PREP_UPLOAD_EXTS as readonly string[]).includes(ext)) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `目录 ${dir} 的可上传类型非法：${item}（仅支持 ${DATA_PREP_UPLOAD_EXTS.join(' / ')}）`,
        );
      }
      allowed.add(ext);
    }
    if (allowed.size === 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `目录 ${dir} 的可上传类型至少选择一项（不配置该目录即使用平台默认）`,
      );
    }
    out[dir] = DATA_PREP_UPLOAD_EXTS.filter((ext) => allowed.has(ext));
  }
  return out;
}

function normalizeScenarioFields(raw: unknown, dirs: readonly string[]): Record<string, ScenarioField[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, '数据准备字段约束须为对象（目录名 → 字段清单）');
  }

  const out: Record<string, ScenarioField[]> = {};
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `字段约束引用了数据准备目录清单外的目录：${dir}`);
    }
    if (!Array.isArray(value)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `目录 ${dir} 的字段清单须为数组`);
    }
    if (value.length > MAX_FIELDS_PER_DIR) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `目录 ${dir} 的字段数超过上限 ${MAX_FIELDS_PER_DIR}`);
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

export function scenarioFieldIssues(scenario: AgentScenario | null | undefined): string[] {
  if (!scenario || !Array.isArray(scenario.data_prep_dirs)) return [];
  const dirs = scenario.data_prep_dirs;
  const issues: string[] = [];
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

export function scenarioUploadIssues(scenario: AgentScenario | null | undefined): string[] {
  const raw = scenario?.data_prep_uploads;
  if (raw === undefined || raw === null) return [];
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return ['可上传文件类型（data_prep_uploads）须为对象'];
  }
  const dirs = Array.isArray(scenario?.data_prep_dirs) ? scenario.data_prep_dirs : [];
  const issues: string[] = [];
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      issues.push(`可上传文件类型引用了目录清单外的目录：${dir}`);
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`目录 ${dir} 的可上传类型须为数组`);
      continue;
    }
    if (value.length === 0) {
      issues.push(`目录 ${dir} 的可上传类型至少选择一项`);
      continue;
    }
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') {
        issues.push(`目录 ${dir} 的可上传类型含非法项：${JSON.stringify(item)}`);
        continue;
      }
      const ext = item.trim().toLowerCase();
      if (!(DATA_PREP_UPLOAD_EXTS as readonly string[]).includes(ext)) {
        issues.push(`目录 ${dir} 的可上传类型非法：${item}`);
      }
    }
  }
  return issues;
}
