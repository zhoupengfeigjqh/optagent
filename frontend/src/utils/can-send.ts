/**
 * 「能否发送」唯一判据（2026-11-20 收敛为单一实现）。
 *
 * 此前有三套等价但不一致的判据：`useChatStream.canSend`（只看草稿非空）、
 * `Composer` 内部（剥 `/技能名` + 看引用）、`ChatPanel` 传工具栏（前两者的混合），
 * 结果是「草稿只有 `/技能名`」时 Enter 被拦、工具栏按钮却可点，点下去只得到
 * 「请输入消息内容」。现在两处都调用本函数。
 *
 * 第三套（`useChatStream.canSend`）同日**删除**而非改造：状态机拿不到"当前技能"与
 * "待发引用数"（那是 `useChatPanel` 的 UI 状态），接进来只能把组件状态倒灌进 composable；
 * 且收敛后全仓已无消费方。故本文件是「能否发送」的**唯一**判据。
 *
 * 口径（与后端 `content minLength: 1` 同义，并覆盖 026 的"只有附件也能发"）：
 * - 剥掉 `/技能名` 标记后的正文非空 → 可发；
 * - 或带了 `@` 引用 / 附件 → 可发（正文由 `attachmentOnlyPrompt` 合成）；
 * - **只选技能不写正文 → 不可发**（2026-11-20 用户拍板）。
 *
 * 纯函数：不读组件状态、不碰网络，故 Enter 键（`Composer`）与工具栏按钮
 * （`ChatPanel`）可以共享同一判断，不会分裂。
 */
import { stripSkillToken } from '../composables/useSkillMention'

/**
 * @param text 输入区原文（可能含 `/技能名` 标记）
 * @param skill 当前选中的技能名；`null` 表示未选择
 * @param referenceCount 待发引用/附件个数（`@` 引用与上传胶囊之和）
 */
export function canSendContent(
  text: string,
  skill: string | null,
  referenceCount: number,
): boolean {
  if (referenceCount > 0) return true
  return stripSkillToken(text, skill).trim() !== ''
}
