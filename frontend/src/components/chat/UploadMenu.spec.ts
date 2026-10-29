/**
 * 组件测试：上传入口面板（T052 + 003 三空间改造 + 字段约束只读提示）
 *
 * 覆盖：
 * - 目录树渲染取自 `spaces` prop（workspace 接口数据）
 * - 数据准备目录带字段约束时展示**只读提示**（表头须含 / 可选），其余目录不展示
 *   （校验在服务端执行，前端只展示要求，契约 runtime-api-delta.md §3.1）
 * - 可上传类型挂在**二级目录**行下，**不在**空间标题下（2026-10-13：粒度下放到目录，
 *   数据准备的空间值只是平台默认，展示它会误导用户）
 * - 面板自带「×」与 **Esc** 两条关闭入口（2026-10-22：此前只能再次点「+」收起）
 *
 * 运行方式：`npm run test`（本地执行）
 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { WorkspaceSpace } from '../../api/types'
import UploadMenu from './UploadMenu.vue'

/**
 * 面板展开期间会在 `window` 上挂 Esc 监听（捕获阶段），故每个用例结束都必须卸载实例，
 * 否则残留监听会互相干扰（互相 `stopPropagation`，让 `defaultPrevented` 等断言失真）。
 */
enableAutoUnmount(afterEach)

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
          predefined: false,
        },
        {
          dir: '数据准备/产线电价',
          label: '产线电价',
          deletable: true,
          files: [],
          fields: [],
          upload_extensions: ['.json'],
          predefined: false,
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
          predefined: false,
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
          predefined: false,
        },
      ],
    },
  ]
}

function mountMenu(spaces: WorkspaceSpace[] = makeSpaces()) {
  return mount(UploadMenu, { props: { open: true, spaces } })
}

/** 点击某目录按钮 → 读取隐藏 file input 的 `accept`（= 该目录允许的类型） */
async function acceptAfterClick(
  wrapper: ReturnType<typeof mountMenu>,
  dir: string,
): Promise<string> {
  const button = wrapper
    .findAll('button')
    .find((b) => b.text().includes(dir.split('/').pop() ?? dir))
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

/* ---------- 012：清空后空态必须干净（FR-015） ---------- */

describe('UploadMenu - 记录区空态（012 FR-015）', () => {
  it('uploads 为空 ⇒ 不渲染记录区（收起清空后再展开不留残影）', () => {
    const wrapper = mount(UploadMenu, { props: { open: true, spaces: makeSpaces(), uploads: [] } })

    expect(wrapper.find('.upload-menu__uploads').exists()).toBe(false)
    expect(wrapper.findAll('.upload-item')).toHaveLength(0)
    // 目录树照常在（清空只清记录，不清目录）
    expect(wrapper.text()).toContain('生产计划')
  })

  it('有记录时按 localId 渲染，且不再有"已完成 N 个"之类的残留计数', () => {
    const wrapper = mount(UploadMenu, {
      props: {
        open: true,
        spaces: makeSpaces(),
        uploads: [
          {
            localId: 'upload-1',
            dir: '临时空间',
            name: 'a.csv',
            size: 10,
            status: 'success',
            serverFilename: 'a.csv',
            error: null,
          },
        ],
      },
    })

    expect(wrapper.find('.upload-menu__uploads').exists()).toBe(true)
    expect(wrapper.findAll('.upload-item')).toHaveLength(1)
  })
})

/* ---------- 2026-10-22：关闭入口（「×」/ Esc），此前只能再次点「+」收起 ---------- */

/** 从 `document.body` 派发一次 Esc：模拟焦点在输入框/面板内，事件沿捕获→冒泡路径传播 */
function pressEscape(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
  document.body.dispatchEvent(event)
  return event
}

/** 造一个"打开的"原生弹窗（HITL 等），用于验证弹窗的 Esc 语义优先 */
function openDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog')
  dialog.setAttribute('open', '')
  document.body.appendChild(dialog)
  return dialog
}

describe('UploadMenu - 关闭入口（「×」/ Esc）', () => {
  afterEach(() => {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.remove())
  })

  it('渲染「×」关闭按钮，点击 emit close（不必再点「+」收起）', async () => {
    const wrapper = mountMenu()

    const closeBtn = wrapper.find('[aria-label="关闭上传面板"]')
    expect(closeBtn.exists()).toBe(true)

    await closeBtn.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('收起（open=false）时整个面板含「×」均不渲染', () => {
    const wrapper = mount(UploadMenu, { props: { open: false, spaces: makeSpaces() } })

    expect(wrapper.find('.upload-menu').exists()).toBe(false)
    expect(wrapper.find('[aria-label="关闭上传面板"]').exists()).toBe(false)
  })

  it('展开时按 Esc 关闭面板，并拦下这次按键（不冒泡到中栏"中断本轮回答"）', () => {
    const wrapper = mountMenu()
    const bubbled = vi.fn()
    window.addEventListener('keydown', bubbled)

    const event = pressEscape()

    window.removeEventListener('keydown', bubbled)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(event.defaultPrevented).toBe(true)
    // 冒泡阶段收不到 ⇒ 中栏那个"Esc 中断本轮回答"的监听不会执行（回答不会被误掐）
    expect(bubbled).not.toHaveBeenCalled()
  })

  it('收起状态不挂监听：Esc 既不关面板也不拦按键', () => {
    const wrapper = mount(UploadMenu, { props: { open: false, spaces: makeSpaces() } })

    const event = pressEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('有打开的 <dialog> 时放行：Esc 交给弹窗，面板不动', () => {
    const wrapper = mountMenu()
    openDialog()

    const event = pressEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })

  it('卸载后摘除监听：Esc 不再触发 close', () => {
    const wrapper = mountMenu()
    wrapper.unmount()

    const event = pressEscape()

    expect(wrapper.emitted('close')).toBeUndefined()
    expect(event.defaultPrevented).toBe(false)
  })
})
