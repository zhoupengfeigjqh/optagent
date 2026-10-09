/**
 * 组件测试：从本体市场导入 / 更新 SKILL（2026-10-02；更新流 §4.8）
 *
 * 守住五条口径：
 * 1. 打开即扫描市场（这一步就是"市场文件是否变化"的检查）并按状态渲染；
 * 2. 导入走 `installOntoMarketSkill(scenario, ontology, skill_dir)`，成功后 emit installed 并关窗；
 * 3. **导入失败不关窗**：错误留在窗内（与"校验失败不关窗"同一口径）；
 * 4. changed 状态**可选且走更新**（`updateOntoMarketSkill`）；conflict / unchanged / invalid 不可选；
 * 5. 更新遇 `ADM_SKILL_MODIFIED`：窗内展示确认提示，主按钮让位，
 *    点"仍要更新"才携带 confirm=true 重试（MUST NOT 静默覆盖人工修改）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillMarketDialog from './SkillMarketDialog.vue'
import type { OntoMarketItem, OntoMarketListing } from '../../api/onto-market'

const fetchOntoMarket = vi.fn()
const installOntoMarketSkill = vi.fn()
const updateOntoMarketSkill = vi.fn()

vi.mock('../../api/skills', () => ({
  fetchOntoMarket: (...a: unknown[]) => fetchOntoMarket(...a),
  installOntoMarketSkill: (...a: unknown[]) => installOntoMarketSkill(...a),
  updateOntoMarketSkill: (...a: unknown[]) => updateOntoMarketSkill(...a),
}))

function item(overrides: Partial<OntoMarketItem> = {}): OntoMarketItem {
  return {
    scenario: '生产调度',
    ontology: '原材料采购和库存',
    skill_dir: 'raw-material-inventory',
    name: 'raw-material-inventory',
    description: '原材料与库存本体技能',
    invalid_reason: null,
    files: [{ path: 'SKILL.md', size: 100 }],
    hash: 'h1',
    status: 'new',
    ...overrides,
  }
}

function listing(
  items: OntoMarketItem[],
  configured = true,
  reason: string | null = null,
): OntoMarketListing {
  return { configured, reason, items }
}

function mountDialog(open = true) {
  return mount(SkillMarketDialog, { props: { open } })
}

beforeEach(() => {
  fetchOntoMarket.mockReset()
  installOntoMarketSkill.mockReset()
  updateOntoMarketSkill.mockReset()
})

describe('SkillMarketDialog —— 扫描与状态', () => {
  it('打开即扫描市场：渲染技能与状态，new 项可选中', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item()]))
    const wrapper = mountDialog()
    await flushPromises()

    expect(fetchOntoMarket).toHaveBeenCalledTimes(1)
    const btn = wrapper.find('.skill-market__item')
    expect(btn.text()).toContain('raw-material-inventory')
    expect(btn.text()).toContain('可导入')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('changed → "市场文件已变化 · 可更新"且可选；conflict → 不可选', async () => {
    fetchOntoMarket.mockResolvedValue(
      listing([item({ status: 'changed' }), item({ skill_dir: 'other', name: 'other', status: 'conflict' })]),
    )
    const wrapper = mountDialog()
    await flushPromises()

    const buttons = wrapper.findAll('.skill-market__item')
    expect(buttons[0]?.text()).toContain('市场文件已变化')
    expect(buttons[1]?.text()).toContain('库内已有同名技能')

    // conflict 不可选
    await buttons[1]!.trigger('click')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeDefined()

    // changed 可选，主按钮变为"更新选中技能"
    await buttons[0]!.trigger('click')
    const primary = wrapper.find('[data-test="import"]')
    expect(primary.attributes('disabled')).toBeUndefined()
    expect(primary.text()).toContain('更新选中技能')
    expect(installOntoMarketSkill).not.toHaveBeenCalled()
  })

  it('unchanged → "已导入 · 市场无变化"，不可重复导入', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item({ status: 'unchanged' })]))
    const wrapper = mountDialog()
    await flushPromises()

    const btn = wrapper.find('.skill-market__item')
    expect(btn.text()).toContain('已导入 · 市场无变化')
    await btn.trigger('click')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeDefined()
  })

  it('未配置市场目录 → 给出可读原因', async () => {
    fetchOntoMarket.mockResolvedValue(
      listing([], false, '未配置 ONTO_MARKET_DIR（本体市场目录），无法列出可导入的技能'),
    )
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.text()).toContain('未配置 ONTO_MARKET_DIR')
  })
})

describe('SkillMarketDialog —— 导入', () => {
  it('选中 new 项 → 按 (scenario, ontology, skill_dir) 导入；成功 emit installed 并关窗', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item()]))
    installOntoMarketSkill.mockResolvedValue({
      name: 'raw-material-inventory',
      description: 'x',
      files: [],
      installed_at: 't',
      overwritten: false,
    })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.skill-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(installOntoMarketSkill).toHaveBeenCalledWith(
      '生产调度',
      '原材料采购和库存',
      'raw-material-inventory',
    )
    expect(wrapper.emitted('installed')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('导入失败不关窗：错误留在窗内（校验失败不关窗口径）', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item()]))
    installOntoMarketSkill.mockRejectedValue({ code: 'ADM_SKILL_NAME_TAKEN', message: '已存在同名' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.skill-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('update:open')?.at(-1)).not.toEqual([false])
    expect(wrapper.text()).toContain('ADM_SKILL_NAME_TAKEN')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeUndefined()
  })
})

describe('SkillMarketDialog —— 更新（§4.8）', () => {
  it('选中 changed 项 → 走 updateOntoMarketSkill（confirm=false）；成功 emit updated 并关窗', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item({ status: 'changed' })]))
    updateOntoMarketSkill.mockResolvedValue({
      name: 'raw-material-inventory',
      description: 'x',
      files: [],
      installed_at: 't0',
      overwritten: true,
      locally_modified: false,
      affected_agents: ['计划员'],
    })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.skill-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    expect(updateOntoMarketSkill).toHaveBeenCalledWith(
      '生产调度',
      '原材料采购和库存',
      'raw-material-inventory',
      false,
    )
    expect(installOntoMarketSkill).not.toHaveBeenCalled()
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('更新遇 ADM_SKILL_MODIFIED → 窗内出现确认块、主按钮让位；点"仍要更新"携带 confirm=true 重试', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item({ status: 'changed' })]))
    updateOntoMarketSkill
      .mockRejectedValueOnce({ code: 'ADM_SKILL_MODIFIED', message: '库内版本被人工修改过' })
      .mockResolvedValueOnce({
        name: 'raw-material-inventory',
        description: 'x',
        files: [],
        installed_at: 't0',
        overwritten: true,
        locally_modified: true,
        affected_agents: [],
      })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.skill-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()

    // 确认块出现（含确认按钮）；主按钮让位禁用；不关窗
    const confirmBtn = wrapper.find('[data-test="confirm-update"]')
    expect(confirmBtn.exists()).toBe(true)
    expect(wrapper.text()).toContain('库内版本被人工修改过')
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('update:open')?.at(-1)).not.toEqual([false])

    await confirmBtn.trigger('click')
    await flushPromises()

    expect(updateOntoMarketSkill).toHaveBeenLastCalledWith(
      '生产调度',
      '原材料采购和库存',
      'raw-material-inventory',
      true,
    )
    expect(wrapper.emitted('updated')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })

  it('确认块可取消：点取消后确认块消失、主按钮恢复', async () => {
    fetchOntoMarket.mockResolvedValue(listing([item({ status: 'changed' })]))
    updateOntoMarketSkill.mockRejectedValue({ code: 'ADM_SKILL_MODIFIED', message: '被人工修改' })
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('.skill-market__item').trigger('click')
    await wrapper.find('[data-test="import"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="confirm-update"]').exists()).toBe(true)

    await wrapper.find('.skill-market__confirm-actions .btn').trigger('click')
    expect(wrapper.find('[data-test="confirm-update"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="import"]').attributes('disabled')).toBeUndefined()
  })
})
