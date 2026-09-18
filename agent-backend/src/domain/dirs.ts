/**
 * 目录初始化与场景（scenario）模块：`.opt-agent/` 运行期数据根。
 *
 * 文件空间固定 3 个一级目录（空间）：
 * - `数据准备/`：Agent 只读；二级子目录由**该数字人**的
 *   `users/{userId}/agents/{agentName}/scenario.json` 预定义（改文件即生效，
 *   运行期按 mtime 惰性重读）。场景属**数字人级**，故同一用户的不同数字人
 *   可有各自的可见目录清单，互不干扰
 * - `共享空间/`：Agent 只读
 * - `临时空间/`：Agent 可读写（写产出强制 `{thread_id}_` 前缀，7 天未访问清理）
 *
 * 注意：三个空间下的**文件数据**仍是用户级的（`users/{userId}/user-data/`，
 * 同一用户的数字人共享一份）；只有场景配置随数字人分开存放。
 *
 * scenario.json 缺失/损坏：空间骨架照常创建，业务接口报
 * SCENARIO_NOT_CONFIGURED（"数字人未设置文件空间场景"），服务不中断。
 *
 * 幂等：重复调用不产生副作用。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 三个固定空间目录 */
export const SPACE_PREP = '数据准备';
export const SPACE_SHARED = '共享空间';
export const SPACE_TMP = '临时空间';
export const SPACES = [SPACE_PREP, SPACE_SHARED, SPACE_TMP] as const;
export type SpaceName = (typeof SPACES)[number];

export const THREADS_DIR = 'threads';

/** 各空间允许上传的扩展名（小写含点） */
const DOCUMENT_EXTS = ['.csv', '.xlsx', '.txt', '.json', '.pdf'] as const;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff'] as const;

export interface SpacePolicy {
  /** Agent 是否可写（仅临时空间） */
  agentWritable: boolean;
  /** 该空间允许上传的扩展名 */
  uploadExtensions: readonly string[];
}

export const SPACE_POLICIES: Record<SpaceName, SpacePolicy> = {
  [SPACE_PREP]: { agentWritable: false, uploadExtensions: ['.csv', '.xlsx'] },
  [SPACE_SHARED]: { agentWritable: false, uploadExtensions: [...DOCUMENT_EXTS, ...IMAGE_EXTS] },
  [SPACE_TMP]: { agentWritable: true, uploadExtensions: [...DOCUMENT_EXTS, ...IMAGE_EXTS] },
};

/** 用户数据根：users/{userId}/user-data */
export function userDataDir(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'user-data');
}

export function userAgentsDir(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'agents');
}

/** 数字人配置目录：users/{userId}/agents/{agentName} */
export function agentDir(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(userAgentsDir(optAgentRoot, userId), agentName);
}

/** 场景配置随数字人存放：users/{userId}/agents/{agentName}/scenario.json */
export function scenarioPath(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(agentDir(optAgentRoot, userId, agentName), 'scenario.json');
}

export function threadDir(optAgentRoot: string, userId: string, threadId: string): string {
  return path.join(userDataDir(optAgentRoot, userId), THREADS_DIR, threadId);
}

/** 初始化用户目录骨架（幂等）：3 空间 + threads + agents；场景子目录由 loadScenario 惰性创建 */
export function ensureUserDirs(optAgentRoot: string, userId: string): void {
  const data = userDataDir(optAgentRoot, userId);
  for (const dir of [...SPACES, THREADS_DIR]) {
    fs.mkdirSync(path.join(data, dir), { recursive: true });
  }
  fs.mkdirSync(userAgentsDir(optAgentRoot, userId), { recursive: true });
}

/** 初始化数据根（幂等）；已知用户逐一初始化 */
export function ensureRootDirs(optAgentRoot: string, userIds: string[] = []): void {
  fs.mkdirSync(optAgentRoot, { recursive: true });
  for (const userId of userIds) ensureUserDirs(optAgentRoot, userId);
}

/* ---------- scenario.json ---------- */

export class ScenarioNotConfiguredError extends Error {
  readonly code = 'SCENARIO_NOT_CONFIGURED';
  constructor(userId: string, agentName: string) {
    super(
      `数字人 ${agentName} 未设置文件空间场景，请联系管理员` +
        `（缺少 users/${userId}/agents/${agentName}/scenario.json）`,
    );
    this.name = 'ScenarioNotConfiguredError';
  }
}

/**
 * 字段取值类型（JSON Schema 基本类型的子集）。
 *
 * 与平台设计态（`admin-backend` `SCENARIO_FIELD_TYPES`）、管理界面
 * （`admin-frontend`）**同一枚举**，三处 MUST 同步（契约 `runtime-api-delta.md` §3.1）。
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

/**
 * 单个字段约束（用于**上传预检**：上传表的表头必须包含必填字段，且取值类型匹配）。
 *
 * `string`/`object`/`array` 之外的判定规则见契约 §3.1；本模块只**承载**约束，
 * 判定发生在未来的上传校验链路（本期不实现）。
 */
export interface ScenarioField {
  name: string;
  type: ScenarioFieldType;
  /** 必填：表头 MUST 存在；`false` 表示可选（出现则类型仍须匹配） */
  required: boolean;
}

export interface Scenario {
  /** 场景名（展示用） */
  name: string;
  /** 数据准备空间的二级子目录清单 */
  dataPrepDirs: string[];
  /**
   * 目录 → 字段约束（`scenario.json` 的 `data_prep_fields`）。
   *
   * 缺失即"该目录无字段约束"（含历史场景配置：本字段是后加的，旧文件没有）；
   * 无约束的目录**不会**以空数组形式出现。
   */
  dataPrepFields: Record<string, ScenarioField[]>;
}

interface ScenarioCacheEntry {
  mtimeMs: number;
  scenario: Scenario;
}

const scenarioCache = new Map<string, ScenarioCacheEntry>();

const DIR_NAME_PATTERN = /^[^/\\..][^/\\]{0,63}$/;

/**
 * 读取**该数字人**的场景配置（mtime 缓存 + 惰性建目录）。
 *
 * - 文件缺失/损坏/字段非法 → ScenarioNotConfiguredError（接口层映射 503）
 * - 成功时确保数据准备下的子目录存在（惰性创建，支持运行期改配置即生效）
 * - 单个非法目录名跳过并计入 `skipped`（不阻断其余目录）
 * - 缓存键含数字人名：同一用户的不同数字人各自缓存，互不串味
 */
export function loadScenario(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  logger?: { warn(msg: string): void },
): Scenario {
  const file = scenarioPath(optAgentRoot, userId, agentName);
  const key = `${optAgentRoot}::${userId}::${agentName}`;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    scenarioCache.delete(key);
    throw new ScenarioNotConfiguredError(userId, agentName);
  }

  const cached = scenarioCache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    ensurePrepDirs(optAgentRoot, userId, cached.scenario.dataPrepDirs);
    return cached.scenario;
  }

  let scenario: Scenario;
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      scenario?: unknown;
      data_prep_dirs?: unknown;
      data_prep_fields?: unknown;
    };
    if (typeof obj.scenario !== 'string' || obj.scenario.trim() === '') {
      throw new Error('scenario 字段缺失');
    }
    if (!Array.isArray(obj.data_prep_dirs)) {
      throw new Error('data_prep_dirs 须为数组');
    }
    const dirs: string[] = [];
    for (const item of obj.data_prep_dirs) {
      if (typeof item !== 'string' || !DIR_NAME_PATTERN.test(item) || item.includes('..')) {
        logger?.warn(`scenario.json 非法目录名已跳过: ${String(item)}`);
        continue;
      }
      if (!dirs.includes(item)) dirs.push(item);
    }
    if (dirs.length === 0) {
      throw new Error('data_prep_dirs 无有效目录');
    }
    scenario = {
      name: obj.scenario.trim(),
      dataPrepDirs: dirs,
      dataPrepFields: parseScenarioFields(obj.data_prep_fields, dirs, logger),
    };
  } catch (err) {
    if (err instanceof ScenarioNotConfiguredError) throw err;
    logger?.warn(
      `scenario.json 读取失败（${err instanceof Error ? err.message : String(err)}），按未配置处理`,
    );
    scenarioCache.delete(key);
    throw new ScenarioNotConfiguredError(userId, agentName);
  }

  scenarioCache.set(key, { mtimeMs: stat.mtimeMs, scenario });
  ensurePrepDirs(optAgentRoot, userId, scenario.dataPrepDirs);
  return scenario;
}

/**
 * 解析 `data_prep_fields`（目录 → 字段约束）。
 *
 * 运行环境是**消费方**：非法内容一律**丢弃并告警**，MUST NOT 因此让整个场景不可用
 * （与目录名的处理同一口径）。丢弃的判据：
 * - 整体非对象 / 某目录的值非数组 / 项非对象；
 * - 字段名非法（空、含路径分隔符或 `..`、超 64 字符）；
 * - 取值类型不在枚举内；`required` 非布尔；
 * - 同目录内字段名重复（保留首个）；
 * - 目录不在**有效目录清单**内（孤儿约束）。
 *
 * 解析结果为空数组的目录不写入：**缺失即"该目录无约束"**，避免留下空壳键。
 */
function parseScenarioFields(
  raw: unknown,
  dirs: readonly string[],
  logger?: { warn(msg: string): void },
): Record<string, ScenarioField[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logger?.warn('scenario.json 的 data_prep_fields 非对象，已忽略');
    return {};
  }

  const out: Record<string, ScenarioField[]> = {};
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      logger?.warn(`scenario.json 字段约束引用了清单外的目录已忽略: ${dir}`);
      continue;
    }
    if (!Array.isArray(value)) {
      logger?.warn(`scenario.json 目录 ${dir} 的字段清单非数组，已忽略`);
      continue;
    }

    const list: ScenarioField[] = [];
    for (const item of value) {
      const field = (item ?? {}) as { name?: unknown; type?: unknown; required?: unknown };
      const name = field.name;
      if (
        typeof name !== 'string' ||
        name.trim() === '' ||
        !DIR_NAME_PATTERN.test(name) ||
        name.includes('..')
      ) {
        logger?.warn(`scenario.json 非法字段名已跳过: ${String(name)}`);
        continue;
      }
      if (!SCENARIO_FIELD_TYPES.includes(field.type as ScenarioFieldType)) {
        logger?.warn(`scenario.json 字段 ${name} 的取值类型非法已跳过: ${String(field.type)}`);
        continue;
      }
      if (typeof field.required !== 'boolean') {
        logger?.warn(`scenario.json 字段 ${name} 的 required 非布尔已跳过`);
        continue;
      }
      if (list.some((f) => f.name === name)) {
        logger?.warn(`scenario.json 目录 ${dir} 的字段名重复已跳过: ${name}`);
        continue;
      }
      list.push({ name, type: field.type as ScenarioFieldType, required: field.required });
    }

    if (list.length > 0) out[dir] = list;
  }
  return out;
}

/** 惰性创建数据准备子目录（幂等） */
function ensurePrepDirs(optAgentRoot: string, userId: string, dirs: readonly string[]): void {
  const prep = path.join(userDataDir(optAgentRoot, userId), SPACE_PREP);
  for (const dir of dirs) {
    fs.mkdirSync(path.join(prep, dir), { recursive: true });
  }
}

/* ---------- 目录参数解析（上传/列表/引用共用） ---------- */

export interface SpaceDirTarget {
  /** 所属空间 */
  space: SpaceName;
  /** 数据准备的二级目录名（其余空间为 undefined） */
  sub?: string;
  /** 相对 user-data 的 posix 路径（如 数据准备/生产计划、共享空间） */
  relPath: string;
}

export class DirValidationError extends Error {
  readonly code = 'DIR_VALIDATION';
  constructor(
    readonly statusCode: 400 | 403,
    message: string,
  ) {
    super(message);
    this.name = 'DirValidationError';
  }
}

/**
 * 解析并校验目录参数（`dir` 为相对 user-data 的路径）：
 * - 穿越/绝对路径/反斜杠 → DirValidationError(400)
 * - 一级必须是三空间之一；仅数据准备允许（且必须）带二级目录，二级须在**该数字人**的
 *   scenario 清单内 → 403（清单随数字人不同而不同）
 * - scenario 未配置 → ScenarioNotConfiguredError（上层映射 503）
 */
export function parseSpaceDir(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  dir: string,
): SpaceDirTarget {
  if (!dir || path.isAbsolute(dir) || dir.includes('..') || dir.includes('\\')) {
    throw new DirValidationError(400, `非法目录参数: ${dir}`);
  }
  const segments = dir.split('/').filter((s) => s.length > 0);
  const space = segments[0] as SpaceName | undefined;
  if (!space || !(SPACES as readonly string[]).includes(space)) {
    throw new DirValidationError(
      403,
      `目录 ${dir} 不开放，允许的空间：${SPACES.join('、')}`,
    );
  }
  if (space === SPACE_PREP) {
    const sub = segments[1];
    if (!sub || segments.length > 2) {
      throw new DirValidationError(400, `数据准备需指定二级目录（如 数据准备/生产计划）: ${dir}`);
    }
    const scenario = loadScenario(optAgentRoot, userId, agentName);
    if (!scenario.dataPrepDirs.includes(sub)) {
      throw new DirValidationError(
        403,
        `目录 ${dir} 不在场景清单内，允许：${scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`).join('、')}`,
      );
    }
    return { space, sub, relPath: `${SPACE_PREP}/${sub}` };
  }
  if (segments.length > 1) {
    throw new DirValidationError(400, `${space} 不支持子目录: ${dir}`);
  }
  return { space, relPath: space };
}
