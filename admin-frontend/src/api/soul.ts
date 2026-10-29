/**
 * 结构化 SOUL 的契约类型（004 / 007）。
 *
 * 与后端 `admin-backend/src/domain/config-center/soul-design.ts` 同口径：
 * - **展示 / 引导**（不进模型）：`intro` / `welcome` / `starters`
 * - **提示词**（进模型）：`mission` / `capability_tags` / `forbidden` / `prompt_extra`
 * - **运行期开关**（既不展示也不进提示词，只作 frontmatter）：`next_action_hints`（007）
 *   及其参数 `next_action_hints_count`（开关开启时每轮最多几条提示）、`intent_focus`（013）
 *
 * 单独成文件的原因：`api/types.ts` 已接近单文件 500 行门禁（宪章原则二）。
 * `types.ts` 会 re-export 这三个类型，既有引用路径不受影响。
 */

/** 问题实例关联的工具引用 */
export interface SoulStarterTool {
  kind: 'builtin' | 'mcp'
  name: string
  /** 仅 `kind: 'mcp'` 存在：所属 MCP 服务名 */
  service?: string
}

/** 问题实例：卡片文本（点击即发送）+ 关联工具（生成隐藏引导） */
export interface SoulStarter {
  prompt: string
  tools: SoulStarterTool[]
}

/** 结构化 SOUL（设计态权威形态） */
export interface SoulDesign {
  intro: string
  welcome: string
  starters: SoulStarter[]
  mission: string
  capability_tags: string[]
  forbidden: string[]
  prompt_extra: string
  /**
   * 是否开启下一步动作提示（007）。
   *
   * **由接口保证恒有该键**（后端读取归一化补 `false`、保存归一化缺省 `false`），
   * 因此这里声明为必填而不是可选：前端不必到处判空，
   * 脏检查（逐字段比较）也不会因 `undefined` / `false` 形态不一致而误报。
   *
   * 语义：开启后该数字人的每一轮回答下方会出现 `next_action_hints_count` 条以内的
   * 可点击的下一步动作卡片；关闭态**部署产物不含该键**（运行环境看不到任何相关配置）。
   */
  next_action_hints: boolean
  /**
   * 下一步动作提示的**条数上限**（007）：开关开启时每轮最多生成几条。
   *
   * **同样由接口保证恒有该键**（后端读取归一化补齐、保存归一化缺省），故声明为必填：
   * 它与 `next_action_hints` 是"开关 + 参数"的一对，脏检查逐字段比较才不会误报。
   *
   * 取值 `1~6`（`SOUL_LIMITS.nextActionHints*`，与后端同口径），缺省 `3`；
   * 开关关闭时**数值仍被保留**（输入框置灰）但**不写进产物**，再次打开即恢复，不必重填。
   */
  next_action_hints_count: number
  /**
   * 是否开启意图聚焦（013）：开启后每轮对话在调主模型前先做一次意图判定。
   *
   * **由接口保证恒有该键**（后端读取归一化补 `false`），故声明为必填；
   * 与 `next_action_hints` **互相独立**（四种组合各自生效）。
   * 关闭态**部署产物不含该键**，运行环境也不会为此多说一次判定调用。
   */
  intent_focus: boolean
}
