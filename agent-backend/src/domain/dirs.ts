/**
 * 目录初始化模块：`.opt-agent/` 运行期数据根。
 *
 * - users/{user_id}/user-data/ 下 7 业务目录 + tmp + shared + threads
 * - users/{user_id}/agents/（数字人配置目录）
 * - logs/ 惰性创建（由 logging 模块自行 mkdir）
 * 幂等：重复调用不产生副作用。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 7 个固定业务目录（Agent 只读，用户可上传） */
export const BUSINESS_DIRS = [
  '生产计划',
  '产线信息',
  '切换时间',
  '求解时间',
  '产线电价',
  '目标优先级',
  '使用规则',
] as const;

export const SHARED_DIR = 'shared';
export const TMP_DIR = 'tmp';
export const THREADS_DIR = 'threads';

/** 用户数据根：users/{userId}/user-data */
export function userDataDir(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'user-data');
}

export function userAgentsDir(optAgentRoot: string, userId: string): string {
  return path.join(optAgentRoot, 'users', userId, 'agents');
}

export function threadDir(optAgentRoot: string, userId: string, threadId: string): string {
  return path.join(userDataDir(optAgentRoot, userId), THREADS_DIR, threadId);
}

/** 初始化用户目录结构（幂等） */
export function ensureUserDirs(optAgentRoot: string, userId: string): void {
  const data = userDataDir(optAgentRoot, userId);
  for (const dir of [...BUSINESS_DIRS, TMP_DIR, SHARED_DIR, THREADS_DIR]) {
    fs.mkdirSync(path.join(data, dir), { recursive: true });
  }
  fs.mkdirSync(userAgentsDir(optAgentRoot, userId), { recursive: true });
}

/** 初始化数据根（幂等）；已知用户逐一初始化 */
export function ensureRootDirs(optAgentRoot: string, userIds: string[] = []): void {
  fs.mkdirSync(optAgentRoot, { recursive: true });
  for (const userId of userIds) ensureUserDirs(optAgentRoot, userId);
}
