import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_PREP_UPLOAD_EXTS,
  PRODUCED_DIR,
  SPACE_POLICIES,
  SPACE_PREP,
  SPACE_TMP,
  SPACES,
  scenarioPath,
  userDataDir,
} from './dirs.js';
import type { SpaceName } from './dirs.js';
import { judgeSpacePath } from './space-path.js';
import type { BrowseCapability, SpacePathDeny } from './space-path.js';

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

export const SCENARIO_FIELD_TYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'object',
  'array',
] as const;
export type ScenarioFieldType = (typeof SCENARIO_FIELD_TYPES)[number];

export interface ScenarioField {
  name: string;
  type: ScenarioFieldType;
  required: boolean;
}

export interface Scenario {
  name: string;
  dataPrepDirs: string[];
  dataPrepFields: Record<string, ScenarioField[]>;
  dataPrepUploads: Record<string, string[]>;
}

interface ScenarioCacheEntry {
  mtimeMs: number;
  scenario: Scenario;
}

const scenarioCache = new Map<string, ScenarioCacheEntry>();

const DIR_NAME_PATTERN = /^[^/\\..][^/\\]{0,63}$/;

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

export function uploadExtensionsOf(
  scenario: Scenario | null | undefined,
  space: SpaceName,
  sub?: string,
): readonly string[] {
  if (space === SPACE_PREP && sub) {
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


export interface SpaceDirTarget {
  space: SpaceName;
  sub?: string;
  /** 相对**数字人数据根**的 posix 路径（如 数据准备/生产计划、临时空间） */
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

export function parseSpaceDir(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  dir: string,
  capability: BrowseCapability = 'browse',
): SpaceDirTarget {
  // 分隔符（模型可能给 Windows 分隔符），HTTP 侧则直接判非法
  if (typeof dir !== 'string' || dir.includes('\\')) {
    throw new DirValidationError(400, `非法目录参数: ${dir}`);
  }
  const verdict = judgeSpacePath(dir, capability, {
    dataPrepDirs: () => loadScenario(optAgentRoot, userId, agentName).dataPrepDirs,
  });
  if (verdict.ok) {
    return {
      space: verdict.space,
      ...(verdict.sub !== undefined ? { sub: verdict.sub } : {}),
      relPath: verdict.relPath,
    };
  }
  throw dirError(verdict, dir, optAgentRoot, userId, agentName);
}

/**
 * 判据 → HTTP 状态码与文案。
 *
 * 与 `FileAccess.explain` 是**同一 `kind` 的两种措辞**：那边面向模型（可自我纠正），
 * 这边面向运维（要指出允许的清单）。两处都 MUST NOT 再补"某种情况下放行"的分支。
 */
function dirError(
  v: SpacePathDeny,
  dir: string,
  optAgentRoot: string,
  userId: string,
  agentName: string,
): DirValidationError {
  switch (v.kind) {
    case 'bad-input':
      return new DirValidationError(400, `非法目录参数: ${dir}`);
    case 'space-forbidden':
      return new DirValidationError(403, `目录 ${dir} 不开放，允许的空间：${SPACES.join('、')}`);
    case 'missing-sub':
    case 'too-deep':
      return new DirValidationError(400, `数据准备需指定二级目录（如 数据准备/生产计划）: ${dir}`);
    case 'not-in-scenario': {
      const allowed = loadScenario(optAgentRoot, userId, agentName).dataPrepDirs;
      return new DirValidationError(
        403,
        `目录 ${dir} 不在场景清单内，允许：${allowed.map((d) => `${SPACE_PREP}/${d}`).join('、')}`,
      );
    }
    case 'not-flat':
      return new DirValidationError(400, `${v.space} 不支持子目录: ${dir}`);
  }
  return new DirValidationError(400, `非法目录参数: ${dir}`);
}


export function listAvailableDirs(
  optAgentRoot: string,
  userId: string,
  agentName: string,
): string[] {
  try {
    const scenario = loadScenario(optAgentRoot, userId, agentName);
    return [...scenario.dataPrepDirs.map((d) => `${SPACE_PREP}/${d}`), SPACE_TMP, PRODUCED_DIR];
  } catch (err) {
    if (err instanceof ScenarioNotConfiguredError) return [SPACE_TMP, PRODUCED_DIR];
    throw err;
  }
}
