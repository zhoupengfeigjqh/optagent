/**
 * 组件测试：SKILL 卡片列表（T096）
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SkillCardList from './SkillCardList.vue'
import type { SkillListItem } from '../../api/types'

const ITEMS: SkillListItem[] = [
  {
    name: 'pdf-parse',
    description: '解析 PDF 文本层',
    installed_at: '2026-09-15T00:00:00.000Z',
    updated_at: '2026-09-15T00:00:00.000Z',
    source: 'upload.zip',
  },
]

function mountList(overrides: Record<string, unknown> = {}) {
  return mount(SkillCardList, {
    props: { items: ITEMS, total: 1, page: 1, loading: false, error: null, ...overrides },
  })
}

describe('SkillCardList', () => {
  it('卡片展示技能名与描述（FR-035）', () => {
    const wrapper = mountList()
    expect(wrapper.text()).toContain('pdf-parse')
    expect(wrapper.text()).toContain('解析 PDF 文本层')
  })

  it('点击「查看与编辑」发出 open(name)', async () => {
    const wrapper = mountList()
    await wrapper.findAll('button').find((b) => b.text() === '查看与编辑')?.trigger('click')
    expect(wrapper.emitted('open')?.[0]).toEqual(['pdf-parse'])
  })

  it('翻页透传 update:page', async () => {
    const wrapper = mountList({ total: 20 })
    await wrapper.findAll('button').find((b) => b.text() === '下一页')?.trigger('click')
    expect(wrapper.emitted('update:page')?.[0]).toEqual([2])
  })

  it('边界：空库显示空态与上传引导', () => {
    const wrapper = mountList({ items: [], total: 0 })
    expect(wrapper.text()).toContain('共享技能库为空')
    expect(wrapper.text()).toContain('SKILL.md')
  })

  it('边界：失败显示可读原因与错误码', () => {
    const wrapper = mountList({
      items: [],
      total: 0,
      error: { code: 'ADM_SKILL_NOT_FOUND', message: 'x' },
    })
    expect(wrapper.text()).toContain('共享技能库中不存在该 SKILL')
    expect(wrapper.text()).toContain('ADM_SKILL_NOT_FOUND')
  })

  it('来源标记：本体市场导入的卡片显示「本体市场」徽标（2026-10-02）', () => {
    const wrapper = mountList({
      items: [
        {
          ...ITEMS[0]!,
          origin: {
            kind: 'onto_market',
            scenario: '生产调度',
            ontology: '原材料采购和库存',
            hash: 'h1',
          },
        },
      ],
    })
    expect(wrapper.find('.card__origin--market').text()).toBe('本体市场 · 只读')
  })

  it('来源标记：非市场来源（ZIP 上传等）显示「外部安装」徽标', () => {
    const wrapper = mountList()
    expect(wrapper.find('.card__origin--external').text()).toBe('外部安装')
  })
})
