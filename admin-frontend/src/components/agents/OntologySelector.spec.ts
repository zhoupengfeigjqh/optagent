/**
 * 组件测试：本体选择器（`FR-058`，2026-10-17）
 *
 * 覆盖 props / emit / 边界：显示名 `{场景名}-{本体名}`、引用值是两段
 * `{场景名}/{本体名}`、失效引用可移除、空库给出可读引导。
 *
 * 关键口径：**显示名 ≠ 引用值**。显示名带场景用于区分同名本体，
 * 引用值必须是两段（部署时按它定位库内目录）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import OntologySelector from './OntologySelector.vue'
import type { OntologyCandidate } from '../../api/ontologies'

function candidate(
  scenario: string,
  dir: string,
  extra: Partial<OntologyCandidate> = {},
): OntologyCandidate {
  return {
    metadata: {
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: scenario,
      scenario_id: 1,
      ontology_name: dir,
      ontology_id: 1,
    },
    ...extra,
  }
}

const ONTOLOGIES: OntologyCandidate[] = [
  candidate('生产调度', '原材料采购和库存'),
  candidate('生产调度', '工艺路线'),
  candidate('资源调度', '原材料采购和库存'),
]

describe('OntologySelector', () => {
  it('候选按 `{场景名}-{本体名}` 展示：同名本体分属不同场景时区分得开', () => {
    const wrapper = mount(OntologySelector, { props: { ontologies: ONTOLOGIES, modelValue: [] } })

    const titles = wrapper.findAll('.checkbox-list__title').map((node) => node.text())
    expect(titles).toEqual([
      '生产调度-原材料采购和库存',
      '生产调度-工艺路线',
      '资源调度-原材料采购和库存',
    ])
  })

  it('说明行放部署版本与创建时间（缺项不显示，不留空占位）', () => {
    const wrapper = mount(OntologySelector, {
      props: {
        ontologies: [
          candidate('生产调度', '原材料采购和库存'),
          candidate('生产调度', '无版本号', {
            metadata: {
              created_at: null,
              deployed_version: null,
              scenario_name: '生产调度',
              scenario_id: null,
              ontology_name: '无版本号',
              ontology_id: null,
            },
          }),
        ],
        modelValue: [],
      },
    })

    const descriptions = wrapper.findAll('.checkbox-list__description').map((n) => n.text())
    expect(descriptions[0]).toContain('版本 v1.0')
    expect(descriptions[0]).toContain('2026-07-15 16:05:02')
    expect(wrapper.findAll('.checkbox-list__item')).toHaveLength(2)
    expect(wrapper.findAll('.checkbox-list__description')).toHaveLength(1)
  })

  it('勾选发出两段引用值 `{场景名}/{本体名}`（不是显示名）', async () => {
    const wrapper = mount(OntologySelector, { props: { ontologies: ONTOLOGIES, modelValue: [] } })

    await wrapper.findAll('input[type="checkbox"]')[2]?.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['资源调度/原材料采购和库存']])
  })

  it('取消勾选从选择集中移除', async () => {
    const wrapper = mount(OntologySelector, {
      props: { ontologies: ONTOLOGIES, modelValue: ['生产调度/工艺路线'] },
    })

    await wrapper.findAll('input[type="checkbox"]')[1]?.setValue(false)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([[]])
  })

  it('失效引用（库内已删）单独列出并可移除', async () => {
    const wrapper = mount(OntologySelector, {
      props: { ontologies: ONTOLOGIES, modelValue: ['生产调度/工艺路线', '已删场景/已删本体'] },
    })

    expect(wrapper.text()).toContain('已失效')
    expect(wrapper.text()).toContain('已删场景/已删本体')

    const remove = wrapper.findAll('button').find((b) => b.text() === '移除')
    await remove?.trigger('click')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([['生产调度/工艺路线']])
  })

  it('空库给出可读引导（去本体管理导入），而不是一片空白', () => {
    const wrapper = mount(OntologySelector, { props: { ontologies: [], modelValue: [] } })
    expect(wrapper.text()).toContain('本体库为空')
    expect(wrapper.text()).toContain('本体管理')
  })

  it('搜索按场景名或本体名过滤，且不清空已选集合', async () => {
    const wrapper = mount(OntologySelector, {
      props: { ontologies: ONTOLOGIES, modelValue: ['生产调度/工艺路线'] },
    })

    await wrapper.find('input[type="search"]').setValue('资源调度')
    expect(wrapper.findAll('[data-test="options"] li')).toHaveLength(1)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
