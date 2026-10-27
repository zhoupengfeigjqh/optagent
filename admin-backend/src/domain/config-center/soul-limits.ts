/**
 * SOUL 设计态的字段上限（单处定义）。
 *
 * 为什么单独成文件：`soul-design.ts`（渲染 / 归一化）与 `soul-fields.ts`（拒绝式读取器）
 * 都要用它；留在 `soul-design.ts` 会形成循环依赖，也会让 500 行门禁再次吃紧。
 *
 * **前端输入框的 maxlength / 计数与后端校验共用同一组数字**，
 * 避免"前端允许输入、后端保存失败"的割裂体验。
 */
export const SOUL_LIMITS = {
  /** 角色简介字数 */
  intro: 100,
  /** 首屏欢迎语字数 */
  welcome: 100,
  /** 单条问题内容字数 */
  starterPrompt: 150,
  /** 问题实例条数 */
  starters: 12,
  /** 单条问题实例可关联的工具数 */
  toolsPerStarter: 10,
  /** 主要使命字数 */
  mission: 4000,
  /** 补充说明字数 */
  promptExtra: 4000,
  /**
   * 下一步动作提示条数（007）：下限、上限与缺省。
   * 开关关闭时**保留**管理员填写的数字（只是不物化进产物），再次打开即恢复，不必重填。
   */
  nextActionHintsMin: 1,
  nextActionHintsMax: 6,
  nextActionHintsDefault: 3,
  /** 能力标签 / 绝对禁止的条数 */
  listItems: 20,
  /** 绝对禁止单项字数 */
  listItemLength: 100,
  /** 能力标签单项字数 */
  capabilityTagLength: 20,
} as const;
