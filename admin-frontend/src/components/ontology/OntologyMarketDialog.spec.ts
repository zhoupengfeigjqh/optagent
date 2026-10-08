/**
 * 组件测试：从本体市场导入 / 更新本体（2026-10-03，契约 §10.4~§10.6）
 *
 * 守住五条：
 * 1. 打开即扫描市场并按状态渲染（这一步就是"ontology.yaml 是否变化"的检查）；
 * 2. new 可导入、changed 可选且走**更新**；unchanged / invalid 不可选；
 * 3. 导入/更新成功后 emit 对应事件并关窗；
 * 4. 失败**不关窗**，错误留在窗内；
 * 5. 未配置市场目录时给出可读原因。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OntologyMarketDialog from './OntologyMarketDialog.vue'
import type { OntologyMarketItem, OntologyMarketListing } from '../../api/ontologies'

const fetchOntoMarketOntologies = vi.fn()
const importOntoMarketOntology = vi.fn()
const updateOntoMarketOntology = vi.fn()

vi.mock('../../api/ontologies', () => ({
  fetchOntoMarketOntologies: (...a: unknown[]) => fetchOntoMarketOntologies(...a),
  importOntoMarketOntology: (...a: unknown[]) => importOntoMarketOntology(...a),
  updateOntoMarketOntology: (...a: unknown[]) => updateOntoMarketOntology(...a),
}))

function item(overrides: Partial<OntologyMarketItem> = {}): OntologyMarketItem {
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
    size: 100,
    hash: 'h1',
    has_securities: false,
    securities_size: 0,
    securities_hash: null,
    status: 'new',
    invalid_reason: null,
    ...overrides,
  }
}

function listing(
  items: OntologyMarketItem[],
  configured = true,
  reason: string | null = null,
): OntologyMarketListing {
  return { configured, reason, items }
}

function mountDialog(open = true) {
  return mount(OntologyMarketDialog, { props: { open } })
}

beforeEach(() => {
  fetchOntoMarketOntologies.mockReset()
  importOntoMarketOntology.mockReset()
  updateOntoMarketOntology.mockReset()
})

describe('OntologyMarketDialog —— 扫描与状态', () => {
  it('打开即扫描：new 项可选中，主按钮为「导入选中本体」', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(listing([item()]))
    const wrapper = mountDialog()
    await flushPromises()

    expect(fetchOntoMarketOntologies).toHaveBeenCalledTimes(1)
    const entry = wrapper.find('.ontology-market__item')
    expect(entry.text()).toContain('原材料采购和库存')
    expect(entry.text()).toContain('可导入')

    await entry.trigger('click')
    const primary = wrapper.find('[data-test="import"]')
    expect(primary.attributes('disabled')).toBeUndefined()
    expect(primary.text()).toContain('导入选中本体')
  })

  it('changed 可选且主按钮变「更新选中本体」；unchanged 不可选', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(
      listing([item({ status: 'changed' }), item({ ontology_dir: '订单排程', status: 'unchanged' })]),
    )
    const wrapper = mountDialog()
    await flushPromises()

    const entries = wrapper.findAll('.ontology-market__item')
    expect(entries[0]?.text()).toContain('市场文件已变化')
    expect(entries[1]?.text()).toContain('已导入 · 市场无变化')

    // unchanged 不可选
    await entries[1]!.trigger('click')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeDefined()

    // changed 可选 → 更新
    await entries[0]!.trigger('click')
    const primary = wrapper.find('[data-test="import"]')
    expect(primary.attributes('disabled')).toBeUndefined()
    expect(primary.text()).toContain('更新选中本体')
  })

  it('invalid 不可选且展示可读原因', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(
      listing([item({ status: 'invalid', invalid_reason: '本体目录缺少 ontology.yaml' })]),
    )
    const wrapper = mountDialog()
    await flushPromises()

    const entry = wrapper.find('.ontology-market__item')
    expect(entry.text()).toContain('本体目录缺少 ontology.yaml')
    await entry.trigger('click')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeDefined()
    expect(importOntoMarketOntology).not.toHaveBeenCalled()
  })

  it('含安全管控的市场条目在描述里标出（无该文件则不标）', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(
      listing([
        item({ has_securities: true, securities_size: 120, securities_hash: 's1' }),
        item({ ontology_dir: '订单排程', name: '订单排程', has_securities: false }),
      ]),
    )
    const wrapper = mountDialog()
    await flushPromises()

    const entries = wrapper.findAll('.ontology-market__item')
    expect(entries[0]?.text()).toContain('含安全管控')
    expect(entries[1]?.text()).not.toContain('含安全管控')
  })

  it('未配置市场目录 → 给出可读原因', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(
      listing([], false, '未配置 ONTO_MARKET_DIR（本体市场目录），无法列出可导入的本体'),
    )
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('未配置 ONTO_MARKET_DIR')
  })
})

describe('OntologyMarketDialog —— 导入 / 更新', () => {
  it('选中 new → 按 (场景, 目录名) 导入；成功 emit imported 并关窗', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(listing([item()]))
    importOntoMarketOntology.mockResolvedValue({
      scenario: '生产调度',
      ontology_dir: '原材料采购和库存',
      name: '原材料采购和库存',
      metadata: item().metadata,
      installed_at: 't',
      overwritten: false,
    })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.ontology-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(importOntoMarketOntology).toHaveBeenCalledWith('生产调度', '原材料采购和库存')
    expect(wrapper.emitted('imported')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('选中 changed → 走更新；成功 emit updated（MUST NOT 调导入）', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(listing([item({ status: 'changed' })]))
    updateOntoMarketOntology.mockResolvedValue({
      scenario: '生产调度',
      ontology_dir: '原材料采购和库存',
      name: '原材料采购和库存',
      metadata: item().metadata,
      installed_at: 't0',
      overwritten: true,
    })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.ontology-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(updateOntoMarketOntology).toHaveBeenCalledWith('生产调度', '原材料采购和库存')
    expect(importOntoMarketOntology).not.toHaveBeenCalled()
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('失败不关窗：错误留在窗内，可再次操作', async () => {
    fetchOntoMarketOntologies.mockResolvedValue(listing([item()]))
    importOntoMarketOntology.mockRejectedValue({
      code: 'ADM_ONTOLOGY_EXISTS',
      message: '已存在同名本体',
    })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.ontology-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).not.toEqual([false])
    expect(wrapper.text()).toContain('ADM_ONTOLOGY_EXISTS')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeUndefined()
  })
})
