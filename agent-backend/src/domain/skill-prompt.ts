/**
 * System Prompt 的技能块组装（2026-11-07）。
 *
 * 为什么抽成纯函数（宪章原则二）：技能块原先在 `agent-instance.ts` 里拼好后
 * 随实例固化，而"本轮只插入用户显式选中的一个技能"是**每轮不同**的请求级语义。
 * 组装规则若在两处各写一遍（实例默认 / 请求级覆盖），默认路径迟早漂移——
 * 而默认路径一旦漂移，存量数字人的提示词与 provider 前缀缓存全部变化。
 *
 * 两条路径（唯一差别是是否给了 `explicitSkill`）：
 * - 默认（无显式技能）：SOUL 正文 + **全部**技能索引 + 通用按需读取引导；
 * - 显式技能：SOUL 正文 + **仅该技能** + 强制先读正文的引导。
 *
 * 默认路径的文案变更 MUST 同步 `tests/unit/agent-instance.spec.ts` 的黄金断言（该处**刻意硬编码**，
 * 是"文案被无意改动即报警"的闸门；顺序、只插一个技能等结构断言在同目录 `skill-prompt.spec.ts`）。
 */
import type { SkillMeta } from '../types.js';

/**
 * 默认路径（全部技能索引）末尾的通用引导。
 *
 * 2026-11-07：两个内置工具**常驻**（不按 `TOOL.json` 的 enabled 裁剪），故可放心并列点名。
 * 措辞刻意区分两条通道的**输出形态**——`read_skill` 给正文（整读），`grep_skill` 只给命中行（定位）：
 * 若写成"读取正文 或 检索"，模型可能 grep 到几行就当作读完技能，漏掉适用范围与前置条件。
 */
export const SKILL_READ_HINT =
  '如果需求与上述技能相关，请调用【read_skill】读取技能正文，或用【grep_skill】检索关键词定位，再回到【read_skill】进行精读。';

/** 显式选中技能时的强制读取引导（不额外加句号：产品文案原样）。 */
export const EXPLICIT_SKILL_READ_HINT =
  '请先利用【read_skill】读取技能正文，或用【grep_skill】检索关键词定位，基于该技能内容进行任务分析和决策。';

export interface ComposeSystemPromptInput {
  /** SOUL 正文（已剥离 frontmatter、已 trim） */
  soulBody: string;
  /** 该数字人已搭配的技能（frontmatter name + description） */
  skills: readonly SkillMeta[];
  /**
   * 本轮用户显式选中的技能名（`/技能名`）。
   *
   * 缺省 = 默认路径；给了但不在 `skills` 里时退回默认路径——调用方（对话路由）
   * 已在开跑前校验过存在性，这里的回退只是防御，不承担用户可读的报错。
   */
  explicitSkill?: string;
}

/** 组装本轮 System Prompt 的技能段。 */
export function composeSystemPrompt(input: ComposeSystemPromptInput): string {
  const { soulBody, skills, explicitSkill } = input;

  // 没有任何技能：无论是否指定（不可能通过路由校验），都退化为 SOUL 正文——
  // 与"未配置技能"的存量行为逐字一致。
  if (skills.length === 0) return soulBody;

  if (explicitSkill !== undefined && explicitSkill !== '') {
    const picked = skills.find((skill) => skill.name === explicitSkill);
    if (picked) {
      return `${soulBody}\n\n${skillSection(picked)}\n\n${EXPLICIT_SKILL_READ_HINT}`;
    }
  }

  const sections = skills.map(skillSection).join('\n\n');
  return `${soulBody}\n\n${sections}\n\n${SKILL_READ_HINT}`;
}

function skillSection(skill: SkillMeta): string {
  return `## 技能：${skill.name}\n${skill.description}`;
}
