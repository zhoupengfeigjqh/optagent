import fs from 'node:fs';
import path from 'node:path';

export const SPACE_PREP = '数据准备';
export const SPACE_TMP = '临时空间';
export const SPACES = [SPACE_PREP, SPACE_TMP] as const;
export type SpaceName = (typeof SPACES)[number];

export const PREDEFINED_DATA_PREP_DIRS = ['算法规则'] as const;

export function isPredefinedDataPrepDir(name: string): boolean {
  return (PREDEFINED_DATA_PREP_DIRS as readonly string[]).includes(name);
}

export const THREADS_DIR = 'threads';

export const SCHEDULED_TASKS_DIR = 'scheduled-tasks';

export function scheduledTasksDir(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(userDataDir(optAgentRoot, userId, agentName), SCHEDULED_TASKS_DIR);
}

/**
 * 后台产出目录（R11）：MCP 异步工具回写结果的落点，**相对数字人数据根**的路径。
 *
 * 为 `临时空间` 的二级目录 —— 刻意**不是**第四个空间：它是临时产物，
 * 生命周期与临时空间一致（30 天未访问即清理），且模型用 `read_file`
 * 按路径读取时天然落进既有白名单（顶层仍是 `临时空间`）。
 */
export const PRODUCED_SUBDIR = '后台产出';
export const PRODUCED_DIR = `${SPACE_TMP}/${PRODUCED_SUBDIR}`;

/**
 * 各空间允许上传的扩展名（小写含点）。
 *
 * `临时空间` 取它（空间级、不可按目录配置）。`.xls` 于 2026-10-14 加入：
 * 客户侧总BOM 等既有资料是 `.xls`（BIFF），与 `.xlsx` 同为 Excel 表格，不应因容器格式不同被拒。
 */
const DOCUMENT_EXTS = ['.csv', '.xlsx', '.xls', '.txt', '.json', '.html', '.pdf'] as const;
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.tif', '.tiff'] as const;

export interface SpacePolicy {
  /** Agent 是否可写（仅临时空间） */
  agentWritable: boolean;
  uploadExtensions: readonly string[];
}

export const SPACE_POLICIES: Record<SpaceName, SpacePolicy> = {
  [SPACE_PREP]: { agentWritable: false, uploadExtensions: ['.csv', '.xlsx'] },
  [SPACE_TMP]: { agentWritable: true, uploadExtensions: [...DOCUMENT_EXTS, ...IMAGE_EXTS] },
};

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

export function userDataRoot(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'user-data');
}

export function userDataDir(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(userDataRoot(optAgentRoot, userId), agentName);
}

export function userAgentsDir(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'agents');
}

export function agentDir(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(userAgentsDir(optAgentRoot, userId), agentName);
}

export function scenarioPath(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(agentDir(optAgentRoot, userId, agentName), 'scenario.json');
}

/**
 * 会话标识的合法字符集（2026-11-26，S1 加固）。
 *
 * **为什么必须是字符集而不是 uuid**：内部生成的 id 是 uuid，但测试与历史数据里存在
 * `th_1` / `t_1` 这类短 id；强制 uuid 会连带打断几十个用例，收益为零。
 * 字符集本身已足以阻断分隔符、`..`、盘符与 NUL。
 */
const THREAD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export class InvalidThreadIdError extends Error {
  readonly code = 'THREAD_ID_INVALID';
  constructor(readonly threadId: string) {
    super('非法会话标识');
    this.name = 'InvalidThreadIdError';
  }
}

export function threadDir(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  threadId: string,
): string {
  if (!THREAD_ID_RE.test(threadId)) throw new InvalidThreadIdError(threadId);
  return path.join(userDataDir(optAgentRoot, userId, agentName), THREADS_DIR, threadId);
}

export function ensureUserDirs(optAgentRoot: string, userId: string): void {
  fs.mkdirSync(userAgentsDir(optAgentRoot, userId), { recursive: true });
}

/**
 * 初始化**某数字人**的数据域骨架（幂等）：3 空间 + threads。
 * 场景子目录由 `loadScenario` 惰性创建；已在磁盘上的内容一律不动（覆盖清理由平台侧负责）。
 */
export function ensureAgentDataDirs(optAgentRoot: string, userId: string, agentName: string): void {
  const data = userDataDir(optAgentRoot, userId, agentName);
  for (const dir of [...SPACES, THREADS_DIR]) {
    fs.mkdirSync(path.join(data, dir), { recursive: true });
  }
}

/** 初始化运行期根（幂等）；已知用户逐一初始化（数字人数据域随选中/使用时惰性创建） */
export function ensureRootDirs(optAgentRoot: string, userIds: string[] = []): void {
  fs.mkdirSync(optAgentRoot, { recursive: true });
  for (const userId of userIds) ensureUserDirs(optAgentRoot, userId);
}

export {
  DirValidationError,
  SCENARIO_FIELD_TYPES,
  ScenarioNotConfiguredError,
  listAvailableDirs,
  loadScenario,
  parseSpaceDir,
  uploadExtensionsOf,
} from './scenario.js';
export type { Scenario, ScenarioField, ScenarioFieldType, SpaceDirTarget } from './scenario.js';
