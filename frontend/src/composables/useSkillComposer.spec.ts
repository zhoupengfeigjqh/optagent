/**
 * 单元测试：`/技能名` 的输入区接线（2026-11-07）。
 *
 * 纪律与 `@` 引用一致：落字只由 `skillToken` 决定、剥离只由 `stripSkillToken` 决定。
 * 这两条只要有人另写一份正则，用例就会红。
 */
import { ref } from 'vue'
import { describe, expect, it } from 'vitest'

import type { AgentsApi } from '../api/agents'
import { createSkillMentionStore, skillToken } from './useSkillMention'
import { useSkillComposer } from './useSkillComposer'

async function setup(draftText = '/supp') {
  const api = {
    skills: async () => ({
      agent_name: 'demo',
      skills: [
        { name: 'supplier-query', description: '查询供应商' },
        { name: 'contract-check', description: '核对合同' },
      ],
    }),
  } as unknown as AgentsApi
  const skill = createSkillMentionStore({ agents: api })
  await skill.load()
  const draft = ref(draftText)
  return { skill, draft, composer: useSkillComposer({ skill, draft }) }
}

describe('useSkillComposer —— 落字', () => {
  it('选择技能：用完整标记替换触发片段', async () => {
    const { draft, composer, skill } = await setup('查一下 /supp')
    composer.onPickSkill('supplier-query')

    expect(draft.value).toBe(`查一下 ${skillToken('supplier-query')} `)
    expect(skill.selected.value).toBe('supplier-query')
  })

  it('单选：选中第二个时先清掉旧标记，不会留下两个', async () => {
    const { draft, composer } = await setup('查一下 ')
    composer.onPickSkill('supplier-query')
    composer.onPickSkill('contract-check')

    expect(draft.value).toBe(`查一下 ${skillToken('contract-check')} `)
    expect(draft.value).not.toContain('supplier-query')
  })

  it('触发片段已被删掉时退化为末尾补标记', async () => {
    const { draft, composer } = await setup('查一下')
    composer.onPickSkill('supplier-query')
    expect(draft.value).toBe(`查一下 ${skillToken('supplier-query')} `)
  })

  it('点胶囊 x：清选择并删标记', async () => {
    const { draft, composer, skill } = await setup('查一下 ')
    composer.onPickSkill('supplier-query')
    composer.onRemoveSkill()

    expect(skill.selected.value).toBeNull()
    expect(draft.value).toBe('查一下')
  })
})

describe('useSkillComposer —— 按键路由', () => {
  it('上下移动、回车确认、Esc 只收面板不丢文本', async () => {
    const { skill, composer, draft } = await setup('/')
    skill.handleInput('/', 1)

    composer.onSkillKey('ArrowDown')
    expect(skill.activeIndex.value).toBe(1)

    composer.onSkillKey('Enter')
    expect(draft.value).toBe(`${skillToken('contract-check')} `)

    skill.handleInput('/', 1)
    composer.onSkillKey('Escape')
    expect(skill.open.value).toBe(false)
    expect(draft.value).toBe(`${skillToken('contract-check')} `)
  })

  it('文本变化转给浮层检测', async () => {
    const { skill, composer } = await setup('/supp')
    composer.onInputText({ value: '/supp', caret: 5 })
    expect(skill.open.value).toBe(true)
  })
})
