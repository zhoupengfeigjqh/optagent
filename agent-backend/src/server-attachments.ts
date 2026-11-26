import type { Logger } from 'pino';
import type { AppConfig } from './config.js';
import type { ReadHistory } from './domain/intent-focus/rewrite.js';
import { IntentFocusRunner, type IntentFocusPort } from './domain/intent-focus/runner.js';
import { IntentFocusStore } from './domain/intent-focus/store.js';
import { NextActionsStore } from './domain/next-actions.js';
import {
  intentFocusDepth,
  isInputRewriteEnabled,
  isIntentFocusEnabled,
  isNextActionsEnabled,
  isTaskPlanningEnabled,
  nextActionHintsCount,
} from './domain/soul.js';
import type { LlmProvider } from './infra/llm/llm-provider.js';
import { LayaClient } from './infra/laya-client.js';
import { createRewriteLlm } from './infra/rewrite-llm.js';
import { createThrottledWarn } from './logging.js';
import type { ModelSelection } from './types.js';

export interface ServerAttachmentsDeps {
  root: string;
  config: AppConfig;
  logger: Logger;
  /**
   * 027：默认模型 provider（与主对话共用同一份惰性单例；测试注入 fake）。
   *
   * 改写**必须**走与主对话同源的 provider：另建一份会绕过既有的重试口径与
   * 测试注入点，"测试里改了模型、线上没改"这类差异最难排查。
   */
  llm: () => LlmProvider;
  providerFor?: (entry: ModelSelection) => LlmProvider;
  readHistory?: ReadHistory;
}

export interface ServerAttachments {
  nextActions: NextActionsStore;
  nextActionsConfig: (
    userId: string,
    agentName: string,
  ) => { enabled: boolean; max: number } | null;
  /** 013：意图聚焦判定口；缺省 = 判定模型未配置（功能不可用） */
  intentFocus?: IntentFocusPort;
}

export function buildAttachments(deps: ServerAttachmentsDeps): ServerAttachments {
  const { root, config, logger } = deps;

  const nextActionsWarn = createThrottledWarn(logger, 'next-actions.failed');
  const nextActions = new NextActionsStore(root, { logger: nextActionsWarn });

  const nextActionsConfig = (userId: string, agentName: string) => {
    if (!isNextActionsEnabled(root, userId, agentName, nextActionsWarn)) return null;
    return { enabled: true, max: nextActionHintsCount(root, userId, agentName, nextActionsWarn) };
  };

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
    isEnabled: (userId, agentName) =>
      isIntentFocusEnabled(root, userId, agentName, focusSwitchWarn),
    getDepth: (userId, agentName) => intentFocusDepth(root, userId, agentName, focusSwitchWarn),
    isRewriteEnabled: (userId, agentName) =>
      isInputRewriteEnabled(root, userId, agentName, focusSwitchWarn),
    // 028：只有开了任务规划的数字人才值得多花一次门禁判定
    isTaskPlanning: (userId, agentName) =>
      isTaskPlanningEnabled(root, userId, agentName, focusSwitchWarn),
    // 027：改写素材只读 history.jsonl 正文；历史读取失败在阶段内部降级为"只有当前输入"
    ...(deps.readHistory ? { readHistory: deps.readHistory } : {}),
    rewriteLlm: createRewriteLlm({
      llm: deps.llm,
      ...(deps.providerFor ? { providerFor: deps.providerFor } : {}),
    }),
    logger,
  });

  return {
    nextActions,
    nextActionsConfig,
    ...(intentFocus ? { intentFocus } : {}),
  };
}
