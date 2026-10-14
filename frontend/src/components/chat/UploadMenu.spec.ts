/**
 * 组件测试：上传入口面板（T052 + 003 三空间改造 + 字段约束只读提示）
 *
 * 覆盖：
 * - 目录树渲染取自 `spaces` prop（workspace 接口数据）
 * - 数据准备目录带字段约束时展示**只读提示**（表头须含 / 可选），其余目录不展示
 *   （校验在服务端执行，前端只展示要求，契约 runtime-api-delta.md §3.1）
 * - 可上传类型挂在**二级目录**行下，**不在**空间标题下（2026-10-13：粒度下放到目录，
 *   数据准备的空间值只是平台默认，展示它会误导用户）
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
          // 目录级白名单（2026-10-13）：与本空间另一个目录不同 ⇒ 证明粒度是目录
          upload_extensions: ['.csv', '.xlsx', '.txt'],
        },
        {
          dir: '数据准备/产线电价',
          label: '产线电价',
          deletable: true,
          files: [],
          fields: [],
          upload_extensions: ['.json'],
        },
      ],
    },
    {
      name: '共享空间',
      agent_writable: false,
      upload_extensions: ['.csv', '.xlsx', '.txt', '.pdf'],
      dirs: [
        {
          dir: '共享空间',
          label: '共享空间',
          deletable: false,
          files: [],
          fields: [],
          upload_extensions: ['.csv', '.xlsx', '.txt', '.pdf'],
        },
      ],
    },
    {
      name: '临时空间',
      agent_writable: true,
      upload_extensions: ['.csv', '.xlsx', '.txt'],
      dirs: [
        {
          dir: '临时空间',
          label: '临时空间',
          deletable: true,
          files: [],
          fields: [],
          upload_extensions: ['.csv', '.xlsx', '.txt'],
        },
      ],
    },
  ]
}

function mountMenu(spaces: WorkspaceSpace[] = makeSpaces()) {
  return mount(UploadMenu, { props: { open: true, spaces } })
}

/** 点击某目录按钮 → 读取隐藏 file input 的 `accept`（= 该目录允许的类型） */
async function acceptAfterClick(wrapper: ReturnType<typeof mountMenu>, dir: string): Promise<string> {
  const button = wrapper.findAll('button').find((b) => b.text().includes(dir.split('/').pop() ?? dir))
  await button?.trigger('click')
  await wrapper.vm.$nextTick()
  return wrapper.find('input[type="file"]').attributes('accept') ?? ''
}

describe('UploadMenu - 目录树与字段约束提示', () => {
  it('渲染全部空间的目录按钮', () => {
    const wrapper = mountMenu()

    expect(wrapper.text()).toContain('生产计划')
    expect(wrapper.text()).toContain('产线电价')
    expect(wrapper.text()).toContain('临时空间')
  })

  it('可上传类型渲染在**每个二级目录**行下，各按本目录取值', () => {
    const wrapper = mountMenu()
    const dirs = wrapper.findAll('.upload-menu__dir')

    expect(dirs[0]!.find('.upload-menu__dir-exts').text()).toBe('.csv .xlsx .txt')
    expect(dirs[1]!.find('.upload-menu__dir-exts').text()).toBe('.json')
  })

  it('类型的左间距随「?」有无切换：有「?」留气口，无「?」（共享/临时空间）紧贴文件名', () => {
    const wrapper = mountMenu()
    const dirs = wrapper.findAll('.upload-menu__dir')

    // 生产计划：有字段约束 ⇒ 有「?」⇒ 加修饰类（左留 4px 气口）
    expect(dirs[0]!.find('.upload-menu__dir-exts').classes()).toContain(
      'upload-menu__dir-exts--after-hint',
    )
    // 产线电价：无字段约束（也就没有「?」）⇒ 不加修饰类（padding-left: 0）
    expect(dirs[1]!.find('.upload-menu__dir-exts').classes()).not.toContain(
      'upload-menu__dir-exts--after-hint',
    )
    // 共享空间 / 临时空间：同样无「?」⇒ 类型紧贴空间名右侧
    expect(dirs[2]!.find('.upload-menu__dir-exts').classes()).not.toContain(
      'upload-menu__dir-exts--after-hint',
    )
    expect(dirs[3]!.find('.upload-menu__dir-exts').classes()).not.toContain(
      'upload-menu__dir-exts--after-hint',
    )
  })

  it('空间标题**不再**展示扩展名（数据准备的空间值只是平台默认，展示会误导）', () => {
    const wrapper = mountMenu()

    expect(wrapper.find('.upload-menu__space-exts').exists()).toBe(false)
    expect(wrapper.findAll('.upload-menu__space-title')[0]!.text()).toBe('数据准备')
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

/* ---------- 2026-10-13：accept 按**目录**生成（FR-011 / 失败判据 2） ---------- */

describe('UploadMenu - 文件选择器 accept 的粒度', () => {
  it('未点击任何目录前 accept 为空', () => {
    const wrapper = mountMenu()
    expect(wrapper.find('input[type="file"]').attributes('accept')).toBe('')
  })

  it('同一数据准备空间内两个目录白名单不同 ⇒ accept 各按本目录生成', async () => {
    const wrapper = mountMenu()

    expect(await acceptAfterClick(wrapper, '数据准备/生产计划')).toBe('.csv,.xlsx,.txt')
    expect(await acceptAfterClick(wrapper, '数据准备/产线电价')).toBe('.json')
  })

  it('共享空间与临时空间的目录：accept 恒等于所属空间的白名单', async () => {
    const wrapper = mountMenu()

    expect(await acceptAfterClick(wrapper, '共享空间')).toBe('.csv,.xlsx,.txt,.pdf')
    expect(await acceptAfterClick(wrapper, '临时空间')).toBe('.csv,.xlsx,.txt')
  })
})
