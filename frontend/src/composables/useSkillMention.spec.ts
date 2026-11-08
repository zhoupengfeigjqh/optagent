/**
 * 单元测试：`/技能名` 单选状态（2026-11-07）。
 *
 * 钉住四条语义：
 * 1. **触发不误伤**：行首/空白后的 `/` 才开面板，`11/7`、`a/b` 不开；
 * 2. **单选**：再选即替换；`pick` 不存在的技能返回 false；
 * 3. **标记与选择同步**：正文里的 `/技能名` 消失 → 选择清空；
 * 4. **剥离**：发送前只去掉该技能标记，其余文本原样保留。
 */
import { describe, expect, it, vi } from 'vitest'

import type { AgentsApi } from '../api/agents'
import type { AgentSkill } from '../api/types'
import { createSkillMentionStore, skillToken, stripSkillToken } from './useSkillMention'

const SKILLS: AgentSkill[] = [
  { name: 'supplier-query', description: '当用户需要查询供应商信息时使用' },
  { name: 'contract-check', description: '当用户需要核对合同时使用' },
]

function fakeAgents(skills: AgentSkill[] = SKILLS): AgentsApi {
  return {
    skills: vi.fn(async () => ({ agent_name: 'demo', skills })),
  } as unknown as AgentsApi
}

async function loaded(skills: AgentSkill[] = SKILLS) {
  const api = fakeAgents(skills)
  const store = createSkillMentionStore({ agents: api })
  await store.load()
  return { api, store }
}

describe('SKILL_TRIGGER_PATTERN —— 只认行首/空白后的 `/`', () => {
  it.each(['/supp', '查一下 /supp', '开头\n/contract'])('触发：%s', (text) => {
    const store = createSkillMentionStore({ agents: fakeAgents() })
    store.handleInput(text, text.length)
    expect(store.open.value).toBe(true)
  })

  it.each(['11/7', 'a/b', '和/或', '已经输入/x'])('不触发：%s', (text) => {
    const store = createSkillMentionStore({ agents: fakeAgents() })
    store.handleInput(text, text.length)
    expect(store.open.value).toBe(false)
  })
})

describe('handleInput —— 过滤与懒加载', () => {
  it('打开时按名称/说明过滤', async () => {
    const { store } = await loaded()
    store.handleInput('/合同', 3)
    expect(store.filtered.value.map((skill) => skill.name)).toEqual(['contract-check'])

    store.handleInput('/suppl', 6)
    expect(store.filtered.value.map((skill) => skill.name)).toEqual(['supplier-query'])
  })

  it('首次触发时懒加载清单（空清单才拉）', async () => {
    const api = fakeAgents()
    const store = createSkillMentionStore({ agents: api })
    store.handleInput('/', 1)
    await vi.waitFor(() => expect(store.skills.value).toHaveLength(2))
    expect(api.skills).toHaveBeenCalledTimes(1)

    store.handleInput('/s', 2)
    expect(api.skills).toHaveBeenCalledTimes(1)
  })

  it('加载失败只置 error，不抛出（输入与发送不受影响）', async () => {
    const api = {
      skills: vi.fn(async () => {
        throw new Error('boom')
      }),
    } as unknown as AgentsApi
    const store = createSkillMentionStore({ agents: api })
    await store.load()
    expect(store.error.value).toBe('技能清单加载失败')
    expect(store.skills.value).toEqual([])
  })
})

describe('选择 / 同步 / 停止', () => {
  it('pick：命中即选中并收起；未命中返回 false 且不改选择', async () => {
    const { store } = await loaded()
    expect(store.pick('supplier-query')).toBe(true)
    expect(store.selected.value).toBe('supplier-query')
    expect(store.open.value).toBe(false)

    expect(store.pick('not-exists')).toBe(false)
    expect(store.selected.value).toBe('supplier-query')
  })

  it('单选：再选即替换', async () => {
    const { store } = await loaded()
    store.pick('supplier-query')
    store.pick('contract-check')
    expect(store.selected.value).toBe('contract-check')
  })

  it('正文里的标记消失 → 选择同步清空（删胶囊/清空草稿）', async () => {
    const { store } = await loaded()
    store.pick('supplier-query')
    store.sync(`查一下 ${skillToken('supplier-query')} 的账期`)
    expect(store.selected.value).toBe('supplier-query')

    store.sync('查一下 的账期')
    expect(store.selected.value).toBeNull()
  })

  it('remove / reset 都清空选择；reset 还清空清单缓存（切数字人）', async () => {
    const { store } = await loaded()
    store.pick('supplier-query')
    store.remove()
    expect(store.selected.value).toBeNull()

    store.pick('contract-check')
    store.reset()
    expect(store.selected.value).toBeNull()
    expect(store.skills.value).toEqual([])
  })

  it('键盘：move 循环、confirmActive 取当前高亮；空清单时回 0', async () => {
    const { store } = await loaded()
    store.handleInput('/', 1)
    store.move(-1)
    expect(store.activeIndex.value).toBe(1)
    expect(store.confirmActive()).toBe('contract-check')

    store.handleInput('/zzz', 4)
    store.move(1)
    expect(store.activeIndex.value).toBe(0)
    expect(store.confirmActive()).toBeNull()
  })
})

describe('stripSkillToken —— 提交前剥离', () => {
  it('只去掉标记，其余文本与引用标记保持原样', () => {
    expect(stripSkillToken('/supplier-query 查一下 @plan.csv 的账期', 'supplier-query')).toBe(
      '查一下 @plan.csv 的账期',
    )
  })

  it('未选技能时原样返回', () => {
    expect(stripSkillToken('/supplier-query 查一下', null)).toBe('/supplier-query 查一下')
  })
})
