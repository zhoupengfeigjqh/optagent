export const SOUL_LIMITS = {
  intro: 100,
  welcome: 100,
  starterPrompt: 150,
  starters: 12,
  toolsPerStarter: 10,
  mission: 4000,
  promptExtra: 4000,
  /**
   * 下一步动作提示条数（007）：下限、上限与缺省。
   * 开关关闭时**保留**管理员填写的数字（只是不物化进产物），再次打开即恢复，不必重填。
   */
  nextActionHintsMin: 1,
  nextActionHintsMax: 6,
  nextActionHintsDefault: 3,
  focusDepthMin: 0,
  focusDepthMax: 2,
  focusDepthDefault: 0,
  /** 能力标签 / 绝对禁止的条数 */
  listItems: 20,
  /** 绝对禁止单项字数 */
  listItemLength: 100,
  capabilityTagLength: 20,
} as const;
