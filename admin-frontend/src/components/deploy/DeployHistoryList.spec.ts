/**
 * 组件测试：部署历史的分页与展开明细（2026-09-16 十三次调整）
 *
 * 两条口径都属于"看不见就会误判"的类型：
 * - **分页**：历史持续追加，整表铺开会把页面撑得极长；每页固定 5 条，
 *   且翻页 MUST NOT 翻出边界、MUST NOT 出现空白页；
 * - **展开明细**：结果列只能说"部分成功/失败"，而"失败的是哪个用户、
 *   哪些数字人、为什么失败"必须能就地看到（数据本就在历史记录里）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DeployHistoryList from './DeployHistoryList.vue'
import type { DeployHistoryItem } from '../../api/types'

function stamp(index: number): string {
  return `2026-09-16T${String(index).padStart(2, '0')}:00:00.000Z`
}

function record(index: number, overrides: Partial<DeployHistoryItem> = {}): DeployHistoryItem {
  return {
    id: `h${index}`,
    deployed_at: stamp(index),
    operator: 'zyw_admin',
    target_runtime_form: 'container_network',
    result: 'succeeded',
    user_count: 1,
    error_count: 0,
    users: [
      { user_id: 'admin', ok: true, agents: [{ name: 'demo', action: 'written', ok: true }] },
    ],
    validation: { passed: true, error_count: 0 },
    manifest_diff: [],
    ...overrides,
  }
}

function mountList(items: DeployHistoryItem[], truncated = false) {
  return mount(DeployHistoryList, { props: { items, truncated } })
}

type Wrapper = ReturnType<typeof mountList>

function byText(wrapper: Wrapper, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text))
}

function rowTexts(wrapper: Wrapper): string[] {
  return wrapper.findAll('tr.deploy-history__row').map((row) => row.text())
}

/** 明细正文用于断言：折掉模板排版带来的空白，避免断言被缩进形状绑架 */
function detailText(wrapper: Wrapper): string {
  return wrapper.find('.deploy-history__detail').text().replace(/\s+/g, '')
}

describe('DeployHistoryList —— 分页（每页 5 条）', () => {
  it('6 条记录分两页：首页 5 行，翻页后只剩 1 行', async () => {
    const wrapper = mountList(Array.from({ length: 6 }, (_, index) => record(index + 1)))

    expect(rowTexts(wrapper)).toHaveLength(5)
    expect(wrapper.text()).toContain('共 6 条，第 1 / 2 页')
    expect(rowTexts(wrapper)[0]).toContain(stamp(1))
    expect(wrapper.text()).not.toContain(stamp(6))

    await byText(wrapper, '下一页')?.trigger('click')

    expect(rowTexts(wrapper)).toHaveLength(1)
    expect(wrapper.text()).toContain('第 2 / 2 页')
    expect(rowTexts(wrapper)[0]).toContain(stamp(6))
    expect(wrapper.text()).not.toContain(stamp(1))
  })

  it('翻不出边界：首页「上一页」不可用、末页「下一页」不可用且点了不动', async () => {
    const wrapper = mountList(Array.from({ length: 6 }, (_, index) => record(index + 1)))

    expect(byText(wrapper, '上一页')?.attributes('disabled')).toBeDefined()

    await byText(wrapper, '下一页')?.trigger('click')
    expect(byText(wrapper, '下一页')?.attributes('disabled')).toBeDefined()

    await byText(wrapper, '下一页')?.trigger('click')
    expect(wrapper.text()).toContain('第 2 / 2 页')
    expect(rowTexts(wrapper)).toHaveLength(1)
  })

  it('不足一页时不出现分页控件，只报总数', () => {
    const wrapper = mountList([record(1), record(2)])

    expect(wrapper.find('nav').exists()).toBe(false)
    expect(wrapper.text()).toContain('共 2 条')
  })

  it('拉到新记录后回到第 1 页（新记录插在最前，否则刚部署完看不见它）', async () => {
    const wrapper = mountList(Array.from({ length: 6 }, (_, index) => record(index + 1)))
    await byText(wrapper, '下一页')?.trigger('click')
    expect(wrapper.text()).toContain('第 2 / 2 页')

    await wrapper.setProps({
      items: [record(9), ...Array.from({ length: 6 }, (_, index) => record(index + 1))],
    })

    expect(wrapper.text()).toContain('第 1 / 2 页')
    expect(rowTexts(wrapper)[0]).toContain(stamp(9))
  })

  it('记录变少导致页码越界时收敛到最后一页（不出现空白页）', async () => {
    const wrapper = mountList(Array.from({ length: 11 }, (_, index) => record(index + 1)))
    await byText(wrapper, '下一页')?.trigger('click')
    await byText(wrapper, '下一页')?.trigger('click')
    expect(wrapper.text()).toContain('第 3 / 3 页')

    await wrapper.setProps({ items: [record(1), record(2)] })

    expect(rowTexts(wrapper)).toHaveLength(2)
  })

  it('有界返回被截断时说明"更早的记录未拉取"', () => {
    const wrapper = mountList([record(1)], true)

    expect(wrapper.text()).toContain('仅显示最近 1 条记录')
  })
})

describe('DeployHistoryList —— 展开行看明细', () => {
  it('展开后显示逐用户结果：失败用户、失败原因、写入与下架的数字人', async () => {
    const wrapper = mountList([
      record(1, {
        result: 'partial',
        user_count: 2,
        error_count: 1,
        users: [
          {
            user_id: 'admin',
            ok: true,
            agents: [
              { name: 'demo', action: 'written', ok: true },
              { name: 'legacy', action: 'removed', ok: true },
            ],
          },
          {
            user_id: 'zpf',
            ok: false,
            agents: [],
            error: '写入运行环境失败（已回滚，该用户零写入）：EACCES permission denied',
          },
        ],
      }),
    ])

    expect(wrapper.find('.deploy-history__detail').exists()).toBe(false)

    await byText(wrapper, '展开')?.trigger('click')

    const text = detailText(wrapper)
    expect(text).toContain('涉及2个用户（失败1个）')
    expect(text).toContain('写入（1）：demo')
    expect(text).toContain('下架（1）：legacy')
    expect(text).toContain('zpf')
    expect(text).toContain('部署失败')
    expect(text).toContain('失败原因：')
    expect(text).toContain('EACCES')
    expect(byText(wrapper, '收起')?.attributes('aria-expanded')).toBe('true')
  })

  it('同时只展开一行：展开第二条时第一条自动收起', async () => {
    const wrapper = mountList([record(1), record(2)])

    await wrapper.findAll('button.deploy-history__toggle')[0]!.trigger('click')
    expect(wrapper.findAll('tr.deploy-history__detail-row')).toHaveLength(1)
    expect(
      wrapper.findAll('button.deploy-history__toggle')[0]!.attributes('aria-expanded'),
    ).toBe('true')

    await wrapper.findAll('button.deploy-history__toggle')[1]!.trigger('click')

    expect(wrapper.findAll('tr.deploy-history__detail-row')).toHaveLength(1)
    expect(
      wrapper.findAll('button.deploy-history__toggle')[0]!.attributes('aria-expanded'),
    ).toBe('false')
    expect(
      wrapper.findAll('button.deploy-history__toggle')[1]!.attributes('aria-expanded'),
    ).toBe('true')
  })

  it('翻页后收起展开行（上一页的明细不留在这一页）', async () => {
    const wrapper = mountList(Array.from({ length: 6 }, (_, index) => record(index + 1)))

    await wrapper.findAll('button.deploy-history__toggle')[0]!.trigger('click')
    expect(wrapper.findAll('tr.deploy-history__detail-row')).toHaveLength(1)

    await byText(wrapper, '下一页')?.trigger('click')

    expect(wrapper.findAll('tr.deploy-history__detail-row')).toHaveLength(0)
  })

  it('校验未通过与差异项同样要能看见（只说"部分成功"无法定位问题）', async () => {
    const wrapper = mountList([
      record(1, {
        validation: { passed: false, error_count: 3 },
        manifest_diff: [
          { user_id: 'admin', target: '', kind: 'missing_in_runtime', detail: '部署失败：boom' },
        ],
      }),
    ])

    await byText(wrapper, '展开')?.trigger('click')

    const text = detailText(wrapper)
    expect(text).toContain('校验未通过（3项）')
    expect(text).toContain('差异项（1条）')
    expect(text).toContain('admin：部署失败：boom')
  })

  it('缺逐用户明细的记录：明确说明"没有明细"，不显示空白', async () => {
    const wrapper = mountList([record(1, { users: undefined })])

    await byText(wrapper, '展开')?.trigger('click')

    expect(detailText(wrapper)).toContain('没有逐用户明细')
  })

  it('未知结果值回退为原始值（MUST NOT 静默显示成空）', () => {
    const wrapper = mountList([record(1, { result: 'cancelled' })])

    expect(wrapper.text()).toContain('cancelled')
  })

  it('没有记录时显示空态，不渲染表格', () => {
    const wrapper = mountList([])

    expect(wrapper.text()).toContain('还没有部署记录')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('「明细」列在**最右**（失败数之后，2026-09-16 十四次调整）', () => {
    const wrapper = mountList([record(1)])
    const headers = wrapper.findAll('th').map((th) => th.text())

    expect(headers[0]).toBe('时间')
    expect(headers[headers.length - 1]).toBe('明细')
    expect(headers.indexOf('失败数')).toBe(headers.length - 2)
  })
})
