import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BaseIcon from './BaseIcon.vue'

/**
 * 内联 SVG 图标（T024 / 011）
 *
 * 本文件是 2026-10-16 补齐的**同名测试**：`BaseIcon.vue` 因 011（预览面板放大 / 缩小）新增
 * `maximize` / `minimize` 两条路径而被改动，按宪章原则三"每个组件 MUST 有同名测试"
 * 与治理"存量文件被改动时，改动部分及其直接受影响的测试 MUST 符合宪章"补齐——
 * 不是对存量组件发起的补测专项。
 *
 * 只钉住**改动直接触及**的三件事：路径渲染、未知名称的降级、无障碍名称的表达。
 */
describe('BaseIcon', () => {
  function pathsOf(name: string): string[] {
    return mount(BaseIcon, { props: { name } })
      .findAll('path')
      .map((path) => path.attributes('d') ?? '')
  }

  it.each(['maximize', 'minimize'])('`%s` 渲染出非空路径（放大 / 缩小成对存在）', (name) => {
    const paths = pathsOf(name)

    expect(paths).toHaveLength(4)
    expect(paths.every((d) => d.trim() !== '')).toBe(true)
  })

  it('放大与缩小是**不同**的两组路径（同一入口两态不能长得一样）', () => {
    expect(pathsOf('maximize')).not.toEqual(pathsOf('minimize'))
  })

  it('未知名称降级为空图标（不抛错、不留坏路径）', () => {
    const icon = mount(BaseIcon, { props: { name: 'no-such-icon' } })

    expect(icon.findAll('path')).toHaveLength(0)
    expect(icon.find('svg').exists()).toBe(true)
  })

  it('默认尺寸 16，可按 `size` 覆盖，且 `focusable="false"`（不抢 Tab）', () => {
    const icon = mount(BaseIcon, { props: { name: 'maximize', size: 20 } })
    const svg = icon.find('svg')

    expect(svg.attributes('width')).toBe('20')
    expect(svg.attributes('height')).toBe('20')
    expect(svg.attributes('focusable')).toBe('false')
  })

  it('未给 `label`：对读屏隐藏（纯装饰）', () => {
    const svg = mount(BaseIcon, { props: { name: 'maximize' } }).find('svg')

    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
    expect(svg.attributes('aria-label')).toBeUndefined()
  })

  it('给了 `label`：以 `img` 角色暴露名称（放大 / 缩小两态各自可读）', () => {
    const svg = mount(BaseIcon, { props: { name: 'maximize', label: '放大页面' } }).find('svg')

    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('放大页面')
    expect(svg.attributes('aria-hidden')).toBeUndefined()
  })

  it('空白 `label` 视同未给（不做半个无障碍名称）', () => {
    const svg = mount(BaseIcon, { props: { name: 'minimize', label: '   ' } }).find('svg')

    expect(svg.attributes('aria-hidden')).toBe('true')
    expect(svg.attributes('role')).toBeUndefined()
  })
})
