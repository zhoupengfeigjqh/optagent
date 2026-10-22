/**
 * 文件路由的**共用入口解析**（012 从 `routes/files.ts` 抽出）。
 *
 * 抽出原因：上传端点迁到 `files-upload.ts`（`files.ts` 已达 500 行硬门禁，宪章原则二），
 * 两个文件都需要"归属数字人 + 目录参数校验"；复制一份会造成越界/归属判定的**双实现**（同一职责两处实现）。
 *
 * 行为与抽出前**逐字一致**（含越界拒绝的审计日志字段），迁移不得改变任何状态码或文案。
 */
import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import {
  DirValidationError,
  PRODUCED_DIR,
  ScenarioNotConfiguredError,
  SPACE_TMP,
  parseSpaceDir,
} from '../domain/dirs.js';
import type { SpaceDirTarget } from '../domain/dirs.js';
import { ApiError } from '../server.js';

/**
 * 文件空间视角所属的数字人＝当前选中数字人（场景随数字人存放，数据域亦随数字人）。
 *
 * 判定**复用唯一入口** `resolveAgentScope`（未选中 → 409 AGENT_NOT_SELECTED；
 * 选中但不可用 → 409 AGENT_NOT_AVAILABLE）：本文件只负责沿用既有文案，MUST NOT
 * 再写一遍"查选中态"的逻辑（双实现漂移，FR-023）。
 */
export function currentAgentFor(ctx: AppContext, userId: string): string {
  return resolveAgentScope(ctx, userId, {
    notSelectedMessage: '请先选定数字人后再操作文件空间',
    route: 'files',
  }).agentName;
}

/** 目录参数统一校验：穿越 → 400；空间外/清单外 → 403；scenario 缺失 → 503 */
export function checkDir(ctx: AppContext, userId: string, agentName: string, dir: string) {
  try {
    return parseSpaceDir(ctx.config.optAgentRoot, userId, agentName, dir);
  } catch (err) {
    if (err instanceof DirValidationError) {
      // 越界拒绝 MUST 可观测（FR-051）：含用户标识、数字人标识与请求线索（被拒的目录参数）
      ctx.loggers.logger.warn(
        {
          alert: false,
          event: 'dir.validation.rejected',
          user_id: userId,
          agent_name: agentName,
          dir,
          status_code: err.statusCode,
          reason: err.message,
        },
        `目录参数被拒（uid=${userId} agent=${agentName} dir=${dir}）：${err.message}`,
      );
      throw new ApiError(
        err.statusCode,
        err.statusCode === 400 ? 'VALIDATION_FAILED' : 'UPLOAD_DIR_FORBIDDEN',
        err.message,
      );
    }
    if (err instanceof ScenarioNotConfiguredError) {
      throw new ApiError(503, 'SCENARIO_NOT_CONFIGURED', err.message);
    }
    throw err;
  }
}

/**
 * **读方向**（预览 / 下载）的目录解析：与 `checkDir` 同一口径，额外放行后台产出目录。
 *
 * 为什么单开这一处（2026-10-21）：MCP 服务回写的产出落在 `临时空间/后台产出/`，而
 * `parseSpaceDir` 对非「数据准备」空间**拒绝二级目录** —— 于是聊天区里的 `filePath` 入口
 * （`临时空间/后台产出/x.xlsx`）点开必然 400。这里只对**这一个**登记过的二级目录放行。
 *
 * 边界（改之前先读完）：
 * - **仅读**：上传 / 删除 / 列目录仍走 `checkDir`——写进去会打乱产出目录的 `.meta.json`
 *   索引（`domain/produced.ts` 的"目录即索引"），删掉会留下悬空记录；
 * - 只认**完全相等**的 `d`，不做前缀匹配：`临时空间/后台产出/子目录` 之类一律交回
 *   `checkDir` 按原规则拒绝；
 * - `parseSpaceDir` 的口径**不动**：模型侧 `read_file` / `list_dir` 的白名单本就包含顶层
 *   临时空间（见 `listAvailableDirs` 的注释），放宽它只会让文件浏览接口的行为漂移。
 */
export function checkDirRead(
  ctx: AppContext,
  userId: string,
  agentName: string,
  dir: string,
): SpaceDirTarget {
  if (dir === PRODUCED_DIR) {
    return { space: SPACE_TMP, relPath: PRODUCED_DIR };
  }
  return checkDir(ctx, userId, agentName, dir);
}
