import type { SkillMeta } from '../types.js';

export const SKILL_READ_HINT =
  '如果需求与上述技能相关，请调用【read_skill】读取技能正文，或用【grep_skill】检索关键词定位，再回到【read_skill】进行精读。';

export const EXPLICIT_SKILL_READ_HINT =
  '请先利用【read_skill】读取技能正文，或用【grep_skill】检索关键词定位，基于该技能内容进行任务分析和决策。';

export interface ComposeSystemPromptInput {
  soulBody: string;
  skills: readonly SkillMeta[];
  explicitSkill?: string;
}

export function composeSystemPrompt(input: ComposeSystemPromptInput): string {
  const { soulBody, skills, explicitSkill } = input;

  // 没有任何技能：无论是否指定（不可能通过路由校验），都退化为 SOUL 正文——
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
