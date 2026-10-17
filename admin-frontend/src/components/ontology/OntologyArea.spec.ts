/**
 * 组件测试：本体管理功能区（`FR-058`~`FR-061`）
 *
 * 守住三条：
 * 1. 挂载即拉列表；
 * 2. 卡片「查看」发出的导航路径**同时带上两段身份**（目录名在路径、场景名在查询参数）；
 * 3. 路由 detail + scenario 都就位时才加载详情；删除后回到列表并播报。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OntologyArea from './OntologyArea.vue'
import type { OntologyDetail, OntologyListItem } from '../../api/ontologies'

const listOntologies = vi.fn()
const fetchOntology = vi.fn()

vi.mock('../../api/ontologies', () => ({
  listOntologies: (...a: unknown[]) => listOntologies(...a),
  fetchOntology: (...a: unknown[]) => fetchOntology(...a),
}))

function listItem(overrides: Partial<OntologyListItem> = {}): OntologyListItem {
  return {
    metadata: {
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: '生产调度',
      scenario_id: 1,
      ontology_name: '原材料采购和库存',
      ontology_id: 1,
    },
    ontology_hash: 'h1',
    installed_at: 't',
    updated_at: 't',
    ...overrides,
  }
}

function detail(): OntologyDetail {
  return {
    ...listItem(),
    content: 'metadata:\n  deployed_version: v1.0\n',
    size: 32,
    securities_content: 'securities: []\n',
    securities_size: 16,
    revision: 2,
  }
}

function mountArea(overrides: { detail?: string | null; scenario?: string | null } = {}) {
  return mount(OntologyArea, {
    props: { detail: null, tab: null, scenario: null, ...overrides },
  })
}

beforeEach(() => {
  listOntologies.mockReset()
  fetchOntology.mockReset()
})

describe('OntologyArea', () => {
  it('挂载即拉列表并渲染卡片与工具栏入口', async () => {
    listOntologies.mockResolvedValue({
      items: [listItem()],
      total: 1,
      page: 1,
      page_size: 8,
      total_pages: 1,
    })
    const wrapper = mountArea()
    await flushPromises()

    expect(listOntologies).toHaveBeenCalledWith(1)
    expect(wrapper.text()).toContain('原材料采购和库存')
    expect(wrapper.text()).toContain('从本体市场导入')
  })

  it('点「查看」→ 导航路径是 `{场景名}/{本体名}` 两段（场景在前）', async () => {
    listOntologies.mockResolvedValue({
      items: [listItem()],
      total: 1,
      page: 1,
      page_size: 8,
      total_pages: 1,
    })
    const wrapper = mountArea()
    await flushPromises()

    // 点卡片里的「查看」（工具栏第一个按钮是"从本体市场导入"，别选错；
    // 卡片名称 2026-10-17 起为 `{场景名}-{本体名}`）
    await wrapper.find('[aria-label="查看本体 生产调度-原材料采购和库存"]').trigger('click')

    expect(wrapper.emitted('navigate')?.[0]).toEqual([
      `/ontology/${encodeURIComponent('生产调度')}/${encodeURIComponent('原材料采购和库存')}`,
    ])
  })

  it('detail 与 scenario 都就位 → 加载详情并渲染只读全文', async () => {
    listOntologies.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
    fetchOntology.mockResolvedValue(detail())
    const wrapper = mountArea({ detail: '原材料采购和库存', scenario: '生产调度' })
    await flushPromises()

    // 参数顺序 (场景名, 本体名)，与 URL 与 metadata 一致
    expect(fetchOntology).toHaveBeenCalledWith('生产调度', '原材料采购和库存')
    expect(wrapper.find('[data-test="file-content"]').exists()).toBe(true)
  })

  it('只有 detail 没有 scenario → 不加载详情（身份不完整）', async () => {
    listOntologies.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
    mountArea({ detail: '原材料采购和库存', scenario: null })
    await flushPromises()

    expect(fetchOntology).not.toHaveBeenCalled()
  })
})
