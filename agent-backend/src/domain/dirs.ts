/**
 * 目录初始化与路径工厂：`.opt-agent/` 运行期数据根。
 *
 * **数据归属（009 智能体数据隔离）**：三个文件空间与 `threads/` 一律**数字人级**——
 * 落点 `users/{userId}/user-data/{agentName}/`。同一用户的数字人各自一份数据域，
 * 互不可见；用户级 `users/{userId}/user-data/` 只作为**迁移的源**存在（见
 * `domain/data-migration.ts`），业务代码 MUST NOT 直接按它拼路径。
 *
 * 文件空间固定 3 个一级目录（空间）：
 * - `数据准备/`：Agent 只读；二级子目录由**该数字人**的
 *   `users/{userId}/agents/{agentName}/scenario.json` 预定义（改文件即生效，
 *   运行期按 mtime 惰性重读）。场景属**数字人级**，故同一用户的不同数字人
 *   可有各自的可见目录清单，互不干扰
 * - `共享空间/`：Agent 只读
 * - `临时空间/`：Agent 可读写（写产出强制 `{thread_id}_` 前缀，30 天未访问清理）
 *
 * `threads/`：会话记录（001 会话持久化）——**会话同样按数字人隔离**，落点
 * `users/{userId}/user-data/{agentName}/threads/{threadId}/`。
 *
 * scenario.json 缺失/损坏：空间骨架照常创建，业务接口报
 * SCENARIO_NOT_CONFIGURED（"数字人未设置文件空间场景"），服务不中断。
 *
 * 幂等：重复调用不产生副作用。
 *
 * 本文件在 2026-10-14（009）**必须先拆再改**（改造前 504 行，越过宪章原则二 500 行门禁）：
 * 场景（scenario.json）解析块整体搬到 `domain/scenario.ts`，此处只留**路径与空间策略**；
 * scenario 侧符号由本文件**原样 re-export**，既有导入路径无需改动。
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
 * `共享空间` / `临时空间` 取它（空间级、不可按目录配置）。`.xls` 于 2026-10-14 加入：
 * 客户侧总BOM 等既有资料是 `.xls`（BIFF），与 `.xlsx` 同为 Excel 表格，不应因容器格式不同被拒。
 */
const DOCUMENT_EXTS = ['.csv', '.xlsx', '.xls', '.txt', '.json', '.pdf'] as const;
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

/** 「数据准备」可上传类型候选；与 admin-backend / admin-frontend 同名常量三处 MUST 同步（契约 §3），枚举外的项丢弃并告警 */
export const DATA_PREP_UPLOAD_EXTS = [
  '.xlsx', '.xls', '.csv', '.txt', '.pdf', '.json', '.zip', '.jpg', '.png', '.jpeg',
] as const;

/**
 * 用户数据根（**用户级**）：`users/{userId}/user-data`。
 *
 * 009 之后它**不是**业务数据域，而是"全部数字人数据域的父目录"：
 * 直接子项应当只有各数字人目录。仅 **迁移**（`domain/data-migration.ts`）与
 * "是否需要迁移"的判据使用它；业务路径一律用 `userDataDir(root, uid, agent)`。
 */
export function userDataRoot(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'user-data');
}

/** 数字人数据根（**数据域**）：`users/{userId}/user-data/{agentName}` */
export function userDataDir(optAgentRoot: string, userId: string, agentName: string): string {
  return path.join(userDataRoot(optAgentRoot, userId), agentName);
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

/** 会话目录（数字人级）：users/{userId}/user-data/{agentName}/threads/{threadId} */
export function threadDir(
  optAgentRoot: string,
  userId: string,
  agentName: string,
  threadId: string,
): string {
  return path.join(userDataDir(optAgentRoot, userId, agentName), THREADS_DIR, threadId);
}

/**
 * 初始化**用户级**骨架（幂等）：只建 `agents/`。
 *
 * 用户级**没有**数据目录：三空间与 `threads/` 都归数字人（`ensureAgentDataDirs`），
 * MUST NOT 在此处预建 `user-data/`——否则"平台只可为新建用户创建空目录骨架"会退化成
 * 造出一层空的用户数据根，与"按数字人覆盖"的部署语义冲突（原则五）。
 */
export function ensureUserDirs(optAgentRoot: string, userId: string): void {
  fs.mkdirSync(userAgentsDir(optAgentRoot, userId), { recursive: true });
}

/**
 * 初始化**某数字人**的数据域骨架（幂等）：3 空间 + threads。
 * 场景子目录由 `loadScenario` 惰性创建；已在磁盘上的内容一律不动（覆盖清理由平台侧负责）。
 */
export function ensureAgentDataDirs(
  optAgentRoot: string,
  userId: string,
  agentName: string,
): void {
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

/* ------------------------------------------------------------------ *
 * scenario.json：实现搬到 `domain/scenario.ts`（本文件超 500 行门禁，原则二）
 *
 * 此处**原样 re-export**：既有 `from './dirs.js'` 的导入点全部继续有效，
 * 消费者无需改动，也避免为"搬家"制造一次全仓导入重写。
 * ------------------------------------------------------------------ */
export {
  DirValidationError,
  SCENARIO_FIELD_TYPES,
  ScenarioNotConfiguredError,
  listAvailableDirs,
  loadScenario,
  parseSpaceDir,
  uploadExtensionsOf,
} from './scenario.js';
export type {
  Scenario,
  ScenarioField,
  ScenarioFieldType,
  SpaceDirTarget,
} from './scenario.js';
