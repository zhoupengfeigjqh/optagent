/**
 * 组件测试：数据准备目录的「可上传文件类型」窗口（`FR-001`~`FR-004`）。
 *
 * 覆盖口径：候选恰 10 项且顺序固定（2026-10-14 增 `.xls`）；未配置时默认勾选 `.csv` + `.xlsx`；
 * 取消全部则禁用保存并提示；保存 emit `save` 并关窗；取消与 Esc 不发 `save` 且不改 props；
 * 打开时回显已有配置（副本）；键盘可达（原生 checkbox + label）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ScenarioUploadTypesDialog from './ScenarioUploadTypesDialog.vue'

const CANDIDATES = [
  '.xlsx',
  '.xls',
  '.csv',
  '.txt',
  '.pdf',
  '.json',
  '.zip',
  '.jpg',
  '.png',
  '.jpeg',
]

function mountDialog(extensions: string[] = []) {
  return mount(ScenarioUploadTypesDialog, {
    props: { open: true, dir: '生产计划', extensions },
  })
}

function checkboxOrder(wrapper: ReturnType<typeof mountDialog>): string[] {
  return wrapper
    .findAll('input[type="checkbox"]')
    .map((c) => (c.attributes('data-test') ?? '').replace('upload-ext-', ''))
}

function isChecked(wrapper: ReturnType<typeof mountDialog>, ext: string): boolean {
  const el = wrapper.find(`[data-test="upload-ext-${ext}"]`).element as HTMLInputElement
  return el.checked
}

describe('ScenarioUploadTypesDialog', () => {
  it('标题含目标目录名', () => {
    const wrapper = mountDialog()
    expect(wrapper.text()).toContain('生产计划')
    expect(wrapper.find('[data-test="scenario-upload-types-dialog"]').exists()).toBe(true)
  })

  it('候选恰 10 项且顺序固定', () => {
    const wrapper = mountDialog()
    expect(checkboxOrder(wrapper)).toEqual(CANDIDATES)
  })

  it('2026-10-14：.xls 是可勾选项（旧版 Excel，与 .xlsx 同属表格）', () => {
    const wrapper = mountDialog()
    expect(isChecked(wrapper, '.xls')).toBe(false)
    expect(wrapper.find('[data-test="upload-ext-.xls"]').exists()).toBe(true)
  })

  it('未配置（传空数组）时默认勾选 .csv 与 .xlsx', () => {
    const wrapper = mountDialog([])
    expect(isChecked(wrapper, '.csv')).toBe(true)
    expect(isChecked(wrapper, '.xlsx')).toBe(true)
    expect(isChecked(wrapper, '.txt')).toBe(false)
    expect(wrapper.find('[data-test="selected-count"]').text()).toContain('2 / 10')
  })

  it('打开时回显已有配置（副本，不直接改 props）', () => {
    const wrapper = mountDialog(['.csv', '.xlsx', '.txt'])
    expect(isChecked(wrapper, '.txt')).toBe(true)
    expect(isChecked(wrapper, '.json')).toBe(false)
    expect(wrapper.find('[data-test="selected-count"]').text()).toContain('3 / 10')
  })

  it('取消全部勾选后禁用保存并提示"至少选择一种"', async () => {
    const wrapper = mountDialog([])
    await wrapper.find('[data-test="upload-ext-.csv"]').setValue(false)
    await wrapper.find('[data-test="upload-ext-.xlsx"]').setValue(false)

    expect(wrapper.find('[data-test="save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="no-selection"]').text()).toContain('至少选择一种文件类型')

    await wrapper.find('[data-test="save"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('保存：emit 勾选集（按枚举顺序）并关闭', async () => {
    const wrapper = mountDialog([])
    await wrapper.find('[data-test="upload-ext-.txt"]').setValue(true)
    await wrapper.find('[data-test="save"]').trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual(['.xlsx', '.csv', '.txt'])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('取消与 Esc：不发 save、只关窗（不改动配置）', async () => {
    const wrapper = mountDialog(['.csv'])
    await wrapper.find('[data-test="cancel"]').trigger('click')
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])

    const escWrapper = mountDialog(['.csv'])
    const event = new Event('cancel', { cancelable: true })
    await escWrapper.find('dialog').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(escWrapper.emitted('save')).toBeUndefined()
    expect(escWrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('键盘可达：10 个原生 checkbox 各被 label 包裹，且 dialog 有可读标题', () => {
    const wrapper = mountDialog()
    const labels = wrapper.findAll('label')
    expect(labels).toHaveLength(10)
    for (const label of labels) {
      expect(label.find('input[type="checkbox"]').exists()).toBe(true)
    }
    expect(wrapper.find('dialog').attributes('aria-labelledby')).toBe(
      'scenario-upload-types-title',
    )
  })
})
