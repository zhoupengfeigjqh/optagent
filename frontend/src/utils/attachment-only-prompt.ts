/**
 * 只有附件、没有正文时的默认话术（026，2026-11-18）
 *
 * **为什么需要**：发送链路把"正文非空"当前置条件（后端 `content` 有 `minLength: 1`），
 * 于是"只传一个文件、不写字"根本发不出去。与其放宽契约（那要连带改标题回落、意图聚焦、
 * 空白气泡、导出等 7 处），不如在**唯一发送链路**上补一句默认话术——content 恒非空，
 * 下游全部按现状工作。
 *
 * **措辞口径**（用户 2026-11-18 拍板）：
 * - 动词用「查看」而非「解析」——图片类附件 `read_file` 只支持文档类型，
 *   说"解析"会诱导模型对 png 发起一次注定失败的工具调用；
 * - **不带文件名**——文件路径由服务端追加的 `[引用文件] …` 段承载，
 *   正文再列一遍是重复占预算；
 * - 只区分单复数：1 个 →「这个文件」，≥2 个 →「这些文件」。
 */
export const ATTACHMENT_ONLY_SINGLE = '请查看这个文件'
export const ATTACHMENT_ONLY_MULTI = '请查看这些文件'

/**
 * 合成默认话术。
 *
 * @param count 本条消息的附件个数（调用方保证 ≥ 1；`0` 也按单数返回，与"没有附件就不合成"同义）
 */
export function attachmentOnlyPrompt(count: number): string {
  return count >= 2 ? ATTACHMENT_ONLY_MULTI : ATTACHMENT_ONLY_SINGLE
}
