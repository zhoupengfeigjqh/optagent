import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import FileArgsMappingTable from './FileArgsMappingTable.vue'

const TOOLS = [
  {
    name: 'ocr_image',
    description: '识别图片中的文字',
    parameters: {
      type: 'object',
      properties: {
        image: { type: 'string' },
        lang: { type: 'string' },
      },
    },
  },
  {
    name: 'parse_excel_files',
    description: '批量解析 Excel',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              businessType: { type: 'string' },
              excelFileUrl: { type: 'string' },
              realRelativePath: { type: 'string' },
            },
          },
        },
      },
    },
  },
]

function mountTable(modelValue: Record<string, Record<string, string>> = {}, tools = TOOLS) {
  return mount(FileArgsMappingTable, { props: { modelValue, tools } })
}

describe('FileArgsMappingTable', () => {
  it('按 modelValue 渲染行：直链与派生两种模式', () => {
    const wrapper = mountTable({
      ocr_image: { image: 'url' },
      parse_excel_files: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
    })

    expect(wrapper.find('[data-test="row-tool-0"]').exists()).toBe(true)
    expect((wrapper.find('[data-test="row-path-0"]').element as HTMLSelectElement).value).toBe(
      'image',
    )
    expect(wrapper.find('[data-test="row-from-0"]').exists()).toBe(false)
    expect((wrapper.find('[data-test="row-from-1"]').element as HTMLSelectElement).value).toBe(
      'items[].realRelativePath',
    )
  })

  it('三列都是下拉：目标字段枚举自工具 Schema（含数组展开的嵌套路径）', async () => {
    const wrapper = mountTable({}, TOOLS)
    await wrapper.find('[data-test="add-mapping"]').trigger('click')
    await wrapper.find('[data-test="row-tool-0"]').setValue('parse_excel_files')

    const pathSelect = wrapper.find('[data-test="row-path-0"]')
    expect(pathSelect.element.tagName).toBe('SELECT')
    const values = pathSelect.findAll('option').map((o) => o.attributes('value'))
    expect(values).toContain('items[].businessType')
    expect(values).toContain('items[].excelFileUrl')
  })

  it('编辑行发出 update:modelValue（直链模式序列化为 "url"）', async () => {
    const wrapper = mountTable()
    await wrapper.find('[data-test="add-mapping"]').trigger('click')
    await wrapper.find('[data-test="row-tool-0"]').setValue('ocr_image')
    await wrapper.find('[data-test="row-path-0"]').setValue('image')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.at(-1)?.[0]).toEqual({ ocr_image: { image: 'url' } })
  })

  it('派生模式：选方式后出现来源字段，序列化为 "url:from=…"', async () => {
    const wrapper = mountTable({ parse_excel_files: { 'items[].excelFileUrl': 'url' } })
    await wrapper.find('[data-test="row-mode-0"]').setValue('derive')
    await wrapper.find('[data-test="row-from-0"]').setValue('items[].realRelativePath')

    const emitted = wrapper.emitted('update:modelValue')
    expect(emitted?.at(-1)?.[0]).toEqual({
      parse_excel_files: { 'items[].excelFileUrl': 'url:from=items[].realRelativePath' },
    })
  })

  it('回归：切派生模式后来源未填（行无效），v-model 回传**不丢行**（2026-09-19 实踩）', async () => {
    const wrapper = mountTable({ ocr_image: { image: 'url' } })
    await wrapper.find('[data-test="row-mode-0"]').setValue('derive')

    const echoed = wrapper.emitted('update:modelValue')!.at(-1)![0] as Record<
      string,
      Record<string, string>
    >
    expect(echoed).toEqual({})
    await wrapper.setProps({ modelValue: echoed })
    await wrapper.vm.$nextTick()

    // 编辑态的行必须还在，且来源输入框已出现，供用户继续填写
    expect(wrapper.find('[data-test="row-tool-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="row-from-0"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('来源路径非法')
  })

  it('派生形状不符（存量值配置漂移）：保留项显示、行内报错且不写入序列化', async () => {
    const wrapper = mountTable({
      parse_excel_files: { 'items[].excelFileUrl': 'url:from=legacyPath' },
    })

    expect(wrapper.text()).toContain('来源与目标结构须一一对应')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('来源字段下拉只列与目标形状相容的选项（能选到的必然合法）', async () => {
    const wrapper = mountTable({ parse_excel_files: { 'items[].excelFileUrl': 'url' } })
    await wrapper.find('[data-test="row-mode-0"]').setValue('derive')

    const values = wrapper
      .find('[data-test="row-from-0"]')
      .findAll('option')
      .map((o) => o.attributes('value'))
    expect(values).toContain('items[].realRelativePath')
  })

  it('存量值不在当前 Schema 枚举里（schema 漂移）：作为保留项出现在下拉中，行不回写丢失', () => {
    const wrapper = mountTable({ ocr_image: { removedField: 'url' } })
    const pathSelect = wrapper.find('[data-test="row-path-0"]')
    const values = pathSelect.findAll('option').map((o) => o.attributes('value'))
    expect(values).toContain('removedField')
    expect((pathSelect.element as HTMLSelectElement).value).toBe('removedField')
  })

  it('工具/schema 下无法选出不存在的路径（纯下拉，无手填入口）', async () => {
    const wrapper = mountTable({}, TOOLS)
    await wrapper.find('[data-test="add-mapping"]').trigger('click')
    await wrapper.find('[data-test="row-tool-0"]').setValue('ocr_image')

    const pathSelect = wrapper.find('[data-test="row-path-0"]')
    const values = pathSelect.findAll('option').map((o) => o.attributes('value'))
    expect(values).toEqual(expect.arrayContaining(['image', 'lang']))
    expect(values.some((v) => v?.includes('['))).toBe(false)
    expect(pathSelect.attributes('list')).toBeUndefined()
  })

  it('删除行从序列化结果中移除', async () => {
    const wrapper = mountTable({ ocr_image: { image: 'url' } })
    await wrapper.find('[data-test="row-remove-0"]').trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({})
  })

  it('清单外工具：作为保留项出现在工具下拉里，行不回写丢失', async () => {
    const wrapper = mountTable({ legacy_tool: { rawPath: 'url' } })
    const toolSelect = wrapper.find('[data-test="row-tool-0"]')
    const values = toolSelect.findAll('option').map((o) => o.attributes('value'))
    expect(values).toContain('legacy_tool')
    expect(wrapper.text()).toContain('清单外')
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()

    await wrapper.find('[data-test="row-mode-0"]').setValue('derive')
    expect(wrapper.emitted('update:modelValue')?.at(-1)?.[0]).toEqual({})
  })

  it('重复（工具, 路径）映射给出告警', async () => {
    const wrapper = mountTable({ ocr_image: { image: 'url' } })
    await wrapper.find('[data-test="add-mapping"]').trigger('click')
    await wrapper.find('[data-test="row-tool-1"]').setValue('ocr_image')
    await wrapper.find('[data-test="row-path-1"]').setValue('image')

    expect(wrapper.text()).toContain('重复的映射')
  })

  it('空模型展示空态与添加按钮', () => {
    const wrapper = mountTable()
    expect(wrapper.text()).toContain('当前未配置任何文件参数映射')
    expect(wrapper.find('[data-test="add-mapping"]').exists()).toBe(true)
  })
})
