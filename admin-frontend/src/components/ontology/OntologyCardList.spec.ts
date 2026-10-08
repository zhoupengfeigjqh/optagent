/**
 * 组件测试：本体卡片列表（`FR-058`）
 *
 * 守住：6 项 metadata 的标签与取值、缺项显示 `—`、点击「查看」把
 * **两段身份**（场景 + 目录名）交给上层、空库空态、
 * 「含安全管控」徽标只在已同步 `securities.yaml` 时出现（2026-10-03）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OntologyCardList from './OntologyCardList.vue'
import type { OntologyListItem } from '../../api/ontologies'

function item(overrides: Partial<OntologyListItem> = {}): OntologyListItem {
  return {
    scenario: '生产调度',
    ontology_dir: '原材料采购和库存',
    name: '原材料采购和库存',
    metadata: {
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: '生产调度',
      scenario_id: 1,
      ontology_name: '原材料采购和库存',
      ontology_id: 1,
    },
    source: 'onto_market:生产调度',
    hash: 'h1',
    has_securities: false,
    installed_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z',
    ...overrides,
  }
}

function mountList(items: OntologyListItem[]) {
  return mount(OntologyCardList, {
    props: { items, total: items.length, page: 1, loading: false, error: null },
  })
}

describe('OntologyCardList', () => {
  it('卡片展示 6 项 metadata（标签 + 取值）与场景徽标', () => {
    const wrapper = mountList([item()])
    const text = wrapper.text()

    for (const label of ['创建时间', '部署版本', '场景名', '场景 ID', '本体名', '本体 ID']) {
      expect(text).toContain(label)
    }
    expect(text).toContain('2026-07-15 16:05:02')
    expect(text).toContain('v1.0')
    expect(wrapper.find('.card__title').text()).toContain('原材料采购和库存')
    expect(wrapper.find('.card__origin').text()).toBe('生产调度')
  })

  it('缺项显示 `—`（字段缺失不使整张卡片不可用）', () => {
    const wrapper = mountList([
      item({
        metadata: {
          created_at: null,
          deployed_version: null,
          scenario_name: null,
          scenario_id: null,
          ontology_name: null,
          ontology_id: null,
        },
      }),
    ])

    expect(wrapper.findAll('.card__meta-row dd').map((dd) => dd.text())).toEqual([
      '—',
      '—',
      '—',
      '—',
      '—',
      '—',
    ])
  })

  it('「含安全管控」徽标：已同步时出现，未同步时不出现', () => {
    const withSecurities = mountList([item({ has_securities: true })])
    expect(withSecurities.find('[data-test="securities-badge"]').text()).toContain('含安全管控')

    const without = mountList([item()])
    expect(without.find('[data-test="securities-badge"]').exists()).toBe(false)
  })

  it('点击「查看」发出 open，携带场景 + 目录名', async () => {
    const wrapper = mountList([item()])
    await wrapper.find('button.btn').trigger('click')

    expect(wrapper.emitted('open')?.[0]).toEqual([
      { scenario: '生产调度', ontologyDir: '原材料采购和库存' },
    ])
  })

  it('空库 → 空态提示（含导入入口说明）', () => {
    const wrapper = mountList([])
    expect(wrapper.text()).toContain('本体库为空')
  })
})
