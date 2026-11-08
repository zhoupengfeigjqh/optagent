/**
 * 单元测试：System Prompt 技能块组装（2026-11-07）。
 *
 * 守住三件事：
 * 1. **默认路径逐字不变**：无显式技能时输出与改造前（SOUL + 全部索引 + 通用引导）完全一致；
 * 2. **显式技能只插一个**：其他技能名与其 description MUST NOT 出现，末尾是强制读取引导；
 * 3. **无技能不变**：输出就是 SOUL 正文（含"显式技能不存在"的防御回退）。
 */
import { describe, expect, it } from 'vitest';

import {
  EXPLICIT_SKILL_READ_HINT,
  SKILL_READ_HINT,
  composeSystemPrompt,
} from '../../src/domain/skill-prompt.js';

const SOUL = '你是供应商助手。';
const SKILLS = [
  { name: 'supplier-query', description: '当用户需要查询供应商信息时使用' },
  { name: 'contract-check', description: '当用户需要核对合同时使用' },
] as const;

describe('composeSystemPrompt —— 默认路径（无显式技能）', () => {
  it('全部技能按原顺序拼接，末尾是通用引导（与改造前逐字一致）', () => {
    expect(composeSystemPrompt({ soulBody: SOUL, skills: SKILLS })).toBe(
      [
        SOUL,
        '',
        '## 技能：supplier-query',
        '当用户需要查询供应商信息时使用',
        '',
        '## 技能：contract-check',
        '当用户需要核对合同时使用',
        '',
        SKILL_READ_HINT,
      ].join('\n'),
    );
  });

  it('没有技能：输出就是 SOUL 正文（不占一个字符）', () => {
    expect(composeSystemPrompt({ soulBody: SOUL, skills: [] })).toBe(SOUL);
  });
});

describe('composeSystemPrompt —— 显式技能', () => {
  it('只插入选中的技能，末尾是强制读取引导（不含通用引导、不含其他技能）', () => {
    const prompt = composeSystemPrompt({
      soulBody: SOUL,
      skills: SKILLS,
      explicitSkill: 'supplier-query',
    });

    expect(prompt).toBe(
      [SOUL, '', '## 技能：supplier-query', '当用户需要查询供应商信息时使用', '', EXPLICIT_SKILL_READ_HINT].join('\n'),
    );
    expect(prompt).not.toContain('contract-check');
    expect(prompt).not.toContain(SKILL_READ_HINT);
  });

  it('技能名不在清单里：防御性回退到默认路径（存在性由路由校验，不在此报错）', () => {
    const prompt = composeSystemPrompt({
      soulBody: SOUL,
      skills: SKILLS,
      explicitSkill: 'not-exists',
    });

    expect(prompt).toContain('## 技能：supplier-query');
    expect(prompt).toContain('## 技能：contract-check');
    expect(prompt.endsWith(SKILL_READ_HINT)).toBe(true);
  });

  it('空串与缺省等价（都走默认路径）', () => {
    expect(composeSystemPrompt({ soulBody: SOUL, skills: SKILLS, explicitSkill: '' })).toBe(
      composeSystemPrompt({ soulBody: SOUL, skills: SKILLS }),
    );
  });

  it('没有技能时显式指定也不改变输出（输出仍是 SOUL 正文）', () => {
    expect(
      composeSystemPrompt({ soulBody: SOUL, skills: [], explicitSkill: 'supplier-query' }),
    ).toBe(SOUL);
  });
});
