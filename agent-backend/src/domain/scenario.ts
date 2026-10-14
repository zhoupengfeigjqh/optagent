/**
 * 场景（scenario.json）解析与目录参数校验 —— 从 `domain/dirs.ts` 拆出（2026-10-14，009）。
 *
 * 拆分理由：`dirs.ts` 已达 504 行，越过宪章原则二 500 行硬门禁，而本特性必须改它
 * （路径工厂要加数字人一维）。按"一个关注点一个文件"拆开：`dirs.ts` 只留**路径与空间策略**，
 * 本文件承载**场景配置的读取/解析**与**目录参数校验**。
 *
 * 场景属**数字人级**：`users/{userId}/agents/{agentName}/scenario.json`；同一用户的不同数字人
 * 可有各自的可见目录清单与字段/上传约束，互不干扰（缓存键含数字人名）。
 *
 * 消费方口径：非法内容一律**丢弃 + 告警**，MUST NOT 因一处非法让整个场景不可用。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_PREP_UPLOAD_EXTS,
  PRODUCED_DIR,
  SPACE_POLICIES,
  SPACE_PREP,
  SPACE_SHARED,
  SPACE_TMP,
  SPACES,
  scenarioPath,
  userDataDir,
} from './dirs.js';
import type { SpaceName } from './dirs.js';

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
 * **判定已实现**于 `domain/field-check.ts`（`checkUploadBuffer`），由 `routes/files.ts`
 * 在上传暂存后、落盘前调用，且仅对表格类型（`supportsFieldCheck`）触发。
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
  /** 目录 → 可上传类型（`data_prep_uploads`，2026-10-13）；缺失 = 用平台默认，未配置的目录不出现键 */
  dataPrepUploads: Record<string, string[]>;
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
 * - 目录落在**该数字人的数据域**内（`user-data/{agentName}/数据准备`），与隔离口径一致
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
    ensurePrepDirs(optAgentRoot, userId, agentName, cached.scenario.dataPrepDirs);
    return cached.scenario;
  }

  let scenario: Scenario;
  try {
    const obj = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      scenario?: unknown;
      data_prep_dirs?: unknown;
      data_prep_fields?: unknown;
      data_prep_uploads?: unknown;
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
      dataPrepUploads: parseScenarioUploads(obj.data_prep_uploads, dirs, logger),
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
  ensurePrepDirs(optAgentRoot, userId, agentName, scenario.dataPrepDirs);
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

/**
 * 解析 `data_prep_uploads`（目录 → 可上传类型，2026-10-13 新增）。
 *
 * 消费方口径（与 `parseScenarioFields` 一致）：非法内容**丢弃 + 告警**，MUST NOT 让整个场景不可用。
 * 丢弃判据：整体非对象 / 孤儿键 / 值非数组或空数组 / 项非字符串、空串或不在候选枚举内 / 同目录重复（留首个）。
 * 解析后为空的目录不写入（缺失 ≡ 用平台默认）；非法项只丢弃该项，其余合法项保留。
 */
function parseScenarioUploads(
  raw: unknown,
  dirs: readonly string[],
  logger?: { warn(msg: string): void },
): Record<string, string[]> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    logger?.warn('scenario.json 的 data_prep_uploads 非对象，已忽略');
    return {};
  }

  const out: Record<string, string[]> = {};
  for (const [dir, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!dirs.includes(dir)) {
      logger?.warn(`scenario.json 可上传类型引用了清单外的目录已忽略: ${dir}`);
      continue;
    }
    if (!Array.isArray(value)) {
      logger?.warn(`scenario.json 目录 ${dir} 的可上传类型非数组，已忽略`);
      continue;
    }

    const list: string[] = [];
    for (const item of value) {
      if (typeof item !== 'string' || item.trim() === '') {
        logger?.warn(`scenario.json 目录 ${dir} 的可上传类型含非法项已跳过: ${String(item)}`);
        continue;
      }
      const ext = item.toLowerCase();
      if (!(DATA_PREP_UPLOAD_EXTS as readonly string[]).includes(ext)) {
        logger?.warn(`scenario.json 目录 ${dir} 的可上传类型不在候选枚举内已跳过: ${item}`);
        continue;
      }
      if (list.includes(ext)) {
        logger?.warn(`scenario.json 目录 ${dir} 的可上传类型重复已跳过: ${ext}`);
        continue;
      }
      list.push(ext);
    }

    if (list.length > 0) out[dir] = list;
  }
  return out;
}

/**
 * 某上传目标**允许上传的扩展名**（本次改动的**唯一实现**，2026-10-13）。
 *
 * 数据准备 + 有二级目录 → 该目录配置，缺省回落平台默认；其余空间（含数据准备空间根）恒取
 * `SPACE_POLICIES`。上传校验与 `workspace` 下发共用它，"界面允许的"与"服务端放行的"永远同源（契约 §3）。
 *
 * `scenario` 可为 `null`（调用方未加载场景）：仅当空间非数据准备、或未指定二级目录时合法
 * （此时判定与场景无关）。
 */
export function uploadExtensionsOf(
  scenario: Scenario | null | undefined,
  space: SpaceName,
  sub?: string,
): readonly string[] {
  if (space === SPACE_PREP && sub) {
    // scenario 为 null（调用方未加载场景）时按平台默认处理：与"未配置该目录"同一语义
    return scenario?.dataPrepUploads[sub] ?? SPACE_POLICIES[SPACE_PREP].uploadExtensions;
  }
  return SPACE_POLICIES[space].uploadExtensions;
}

/** 惰性创建数据准备子目录（幂等）——落在该数字人的数据域内 */
function ensurePrepDirs(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  dirs: readonly string[],
): void {
  const prep = path.join(userDataDir(optAgentRoot, userId, agentName), SPACE_PREP);
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
  /** 相对**数字人数据根**的 posix 路径（如 数据准备/生产计划、共享空间） */
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
 * 解析并校验目录参数（`dir` 为相对**数字人数据根**的路径）：
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

/* ---------- 模型可用目录清单 ---------- */

/**
 * 模型可用目录清单（`read_file` / `list_dir` / `grep_files` 的说明与示例取值来源）。
 *
 * = 数据准备子目录（**该数字人** scenario 定义）+ 共享空间 + 临时空间 + `临时空间/后台产出`。
 *
 * **产出目录为什么进清单**（契约 §10.8）：产出清单只注入**发起会话**，换会话后模型既看不到
 * 清单也不知道落点。把它写进 `list_dir` 的说明，模型即可自行列目录、按路径取回——这是
 * **纯"告知"**：该目录本就在 `FileAccess` 白名单内（顶层 `临时空间`，不限二级目录），
 * 此前就能读，本清单不参与任何权限校验。
 *
 * **MUST 追加在末尾**：`{示例路径}` / `{首个目录}` 取首项，末尾追加才能保证那两处取值不变。
 *
 * **与 `parseSpaceDir` 的口径差异是有意的**：文件浏览 API 对非数据准备空间拒绝二级目录
 * （`临时空间/后台产出` 判 400）。两者消费者不同（模型内置工具 vs 管理端浏览），
 * MUST NOT 为"看起来一致"而放宽 `parseSpaceDir`。
 *
 * 场景未配置时退化为三空间根（不含数据准备子目录），产出目录同样在末尾。
 */
export function listAvailableDirs(
  optAgentRoot: string,
  userId: string,
  agentName: string,
): string[] {
  try {
    const scenario = loadScenario(optAgentRoot, userId, agentName);
    return [
      ...scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`),
      SPACE_SHARED,
      SPACE_TMP,
      PRODUCED_DIR,
    ];
  } catch (err) {
    if (err instanceof ScenarioNotConfiguredError) return [SPACE_SHARED, SPACE_TMP, PRODUCED_DIR];
    throw err;
  }
}
