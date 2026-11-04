/**
 * 侧车能力装配（007 下一步动作提示 + 013 意图聚焦）。
 *
 * 从 `server.ts` 外移（宪章原则二）：`server.ts` 已到 498 行、距 500 硬门禁只剩 2 行，
 * 而每新增一个侧车能力都要在这里加几行。抽出来只做**构造**，不含路由与生命周期。
 *
 * 两个能力的共同点：都由 SOUL 开关（frontmatter，逐次现读、fail-closed）门控，
 * 都在缺省时"整体不生效"而非报错——装配失败不得拖垮对话主链路。
 */
import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import { IntentFocusRunner, type IntentFocusPort } from './domain/intent-focus-runner.js';
import { IntentFocusStore } from './domain/intent-focus-store.js';
import { NextActionsStore } from './domain/next-actions.js';
import { isIntentFocusEnabled, isNextActionsEnabled, nextActionHintsCount } from './domain/soul.js';
import { LayaClient } from './infra/laya-client.js';
import { createThrottledWarn } from './logging.js';

export interface ServerAttachmentsDeps {
  /** `.opt-agent` 根目录（绝对路径） */
  root: string;
  config: AppConfig;
  logger: Logger;
}

export interface ServerAttachments {
  /** 007：轮末定稿卡片 + 会话级单快照 */
  nextActions: NextActionsStore;
  /** 007：开关与条数（逐次现读） */
  nextActionsConfig: (
    userId: string,
    agentName: string,
  ) => { enabled: boolean; max: number } | null;
  /** 013：意图聚焦判定口；缺省 = 判定模型未配置（功能不可用） */
  intentFocus?: IntentFocusPort;
}

export function buildAttachments(deps: ServerAttachmentsDeps): ServerAttachments {
  const { root, config, logger } = deps;

  // 007：告警经节流合并——开关文件读不出来时，每个请求都会命中同一条消息
  const nextActionsWarn = createThrottledWarn(logger, 'next-actions.failed');
  const nextActions = new NextActionsStore(root, { logger: nextActionsWarn });

  const nextActionsConfig = (userId: string, agentName: string) => {
    if (!isNextActionsEnabled(root, userId, agentName, nextActionsWarn)) return null;
    return { enabled: true, max: nextActionHintsCount(root, userId, agentName, nextActionsWarn) };
  };

  /**
   * 016：runner **始终装配**，判定模型配置只决定是否带 client。
   *
   * 为什么不再"未配置就整体不装配"：开关开启但模型未配置时，需要留一条
   * `unconfigured` 记录（否则"为什么这轮没聚焦"在日志与侧车里都没有痕迹）。
   * client 缺省时 runner 在读完配置后立即以 `unconfigured` 收尾，不发起任何网络调用。
   */
  const focusConfig = config.intentFocus;
  const focusSwitchWarn = createThrottledWarn(logger, 'intent-focus.switch.failed');
  const intentFocus: IntentFocusPort = new IntentFocusRunner({
    root,
    ...(focusConfig ? { config: focusConfig } : {}),
    ...(focusConfig
      ? {
          client: new LayaClient({
            baseUrl: focusConfig.baseUrl,
            model: focusConfig.model,
            apiKey: focusConfig.apiKey,
            timeoutMs: focusConfig.timeoutMs,
          }),
        }
      : {}),
    store: new IntentFocusStore(
      root,
      createThrottledWarn(logger, 'intent-focus.record.failed'),
    ),
    // 开关逐次现读；读不出来按关闭（fail-closed，见 soul.ts）
    isEnabled: (userId, agentName) =>
      isIntentFocusEnabled(root, userId, agentName, focusSwitchWarn),
    logger,
  });

  return {
    nextActions,
    nextActionsConfig,
    ...(intentFocus ? { intentFocus } : {}),
  };
}
