import type { AppContext } from '../context.js';
import { resolveAgentScope } from '../domain/agent-scope.js';
import { DirValidationError, ScenarioNotConfiguredError, parseSpaceDir } from '../domain/dirs.js';
import type { SpaceDirTarget } from '../domain/dirs.js';
import type { BrowseCapability } from '../domain/space-path.js';
import { ApiError } from '../server.js';

export function currentAgentFor(ctx: AppContext, userId: string): string {
  return resolveAgentScope(ctx, userId, {
    notSelectedMessage: '请先选定数字人后再操作文件空间',
    route: 'files',
  }).agentName;
}

export function checkDir(
  ctx: AppContext,
  userId: string,
  agentName: string,
  dir: string,
  capability: BrowseCapability = 'browse',
) {
  try {
    return parseSpaceDir(ctx.config.optAgentRoot, userId, agentName, dir, capability);
  } catch (err) {
    if (err instanceof DirValidationError) {
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

export function checkDirRead(
  ctx: AppContext,
  userId: string,
  agentName: string,
  dir: string,
): SpaceDirTarget {
  return checkDir(ctx, userId, agentName, dir, 'browse-produced');
}
