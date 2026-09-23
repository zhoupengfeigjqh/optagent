/**
 * 组件测试：上传入口面板（T052 + 003 三空间改造 + 字段约束只读提示）
 *
 * 覆盖：
 * - 目录树渲染取自 `spaces` prop（workspace 接口数据）
 * - 数据准备目录带字段约束时展示**只读提示**（表头须含 / 可选），其余目录不展示
 *   （校验在服务端执行，前端只展示要求，契约 runtime-api-delta.md §3.1）
 *
 * 运行方式：`npm run test`（本地执行）
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { WorkspaceSpace } from '../../api/types'
import UploadMenu from './UploadMenu.vue'

function makeSpaces(): WorkspaceSpace[] {
  return [
    {
      name: '数据准备',
      agent_writable: false,
      upload_extensions: ['.csv', '.xlsx'],
      dirs: [
        {
          dir: '数据准备/生产计划',
          label: '生产计划',
          deletable: true,
          files: [],
          fields: [
            { name: '产线编号', type: 'string', required: true },
            { name: '计划量', type: 'integer', required: false },
          ],
        },
        {
          dir: '数据准备/产线电价',
          label: '产线电价',
          deletable: true,
          files: [],
          fields: [],
        },
      ],
    },
    {
      name: '临时空间',
      agent_writable: true,
      upload_extensions: ['.csv', '.xlsx', '.txt'],
      dirs: [{ dir: '临时空间', label: '临时空间', deletable: true, files: [], fields: [] }],
    },
  ]
}

function mountMenu(spaces: WorkspaceSpace[] = makeSpaces()) {
  return mount(UploadMenu, { props: { open: true, spaces } })
}

describe('UploadMenu - 目录树与字段约束提示', () => {
  it('渲染全部空间的目录按钮', () => {
    const wrapper = mountMenu()

    expect(wrapper.text()).toContain('生产计划')
    expect(wrapper.text()).toContain('产线电价')
    expect(wrapper.text()).toContain('临时空间')
  })

  it('带字段约束的目录默认收起提示，点击「?」后展示「表头须含」与可选列类型标注', async () => {
    const wrapper = mountMenu()

    // 默认不直接展示表头要求文案
    expect(wrapper.find('.hint-tip__pop').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('表头须含')

    // 点击「?」展开浮层
    const btn = wrapper.find('.hint-tip__btn')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')

    const pop = wrapper.find('.hint-tip__pop')
    expect(pop.exists()).toBe(true)
    expect(pop.text()).toContain('表头须含：产线编号')
    expect(pop.text()).toContain('可选：计划量(integer)')
  })

  it('再次点击「?」收起提示浮层', async () => {
    const wrapper = mountMenu()

    const btn = wrapper.find('.hint-tip__btn')
    await btn.trigger('click')
    expect(wrapper.find('.hint-tip__pop').exists()).toBe(true)

    await btn.trigger('click')
    expect(wrapper.find('.hint-tip__pop').exists()).toBe(false)
  })

  it('无约束目录（fields 为空）不渲染「?」按钮', () => {
    const wrapper = mountMenu()

    const btns = wrapper.findAll('.hint-tip__btn')
    expect(btns).toHaveLength(1)
  })

  it('spaces 为空时展示占位文案且不渲染「?」', () => {
    const wrapper = mountMenu([])

    expect(wrapper.text()).toContain('文件空间加载中或尚未配置场景')
    expect(wrapper.find('.hint-tip__btn').exists()).toBe(false)
  })
})
