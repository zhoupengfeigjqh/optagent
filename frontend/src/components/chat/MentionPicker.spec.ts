import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import { SPACE_DIRECTORIES } from '../../constants/directories'
import MentionPicker from './MentionPicker.vue'

const DIRS = [
  { dir: '生产计划', label: '生产计划' },
  { dir: 'shared', label: '共享空间' },
  { dir: 'tmp', label: '临时空间' },
]

describe('MentionPicker', () => {
  it('open=false 时不渲染', () => {
    const wrapper = mount(MentionPicker, { props: { directories: SPACE_DIRECTORIES } })
    expect(wrapper.find('.mention-picker').exists()).toBe(false)
  })

  it('目录阶段固定渲染 9 项且文案为展示名（SC-021）', () => {
    const wrapper = mount(MentionPicker, {
      props: { open: true, directories: SPACE_DIRECTORIES },
    })
    const items = wrapper.findAll('.mention-picker__item')
    expect(items).toHaveLength(9)

    const labels = wrapper.findAll('.mention-picker__label').map((node) => node.text())
    expect(labels).toContain('生产计划')
    expect(labels).toContain('共享空间')
    expect(labels).toContain('临时空间')
  })

  it('高亮项带 active 标记且唯一', () => {
    const wrapper = mount(MentionPicker, {
      props: { open: true, directories: DIRS, activeIndex: 1 },
    })
    const active = wrapper.findAll('[data-active="true"]')
    expect(active).toHaveLength(1)
    expect(active[0].text()).toContain('共享空间')
    expect(active[0].attributes('aria-selected')).toBe('true')
  })

  it('点击目录派发 pick-dir', async () => {
    const wrapper = mount(MentionPicker, { props: { open: true, directories: DIRS } })
    await wrapper.findAll('.mention-picker__item')[2].trigger('click')
    expect(wrapper.emitted('pick-dir')).toEqual([['tmp']])
  })

  it('文件阶段渲染文件并展示目录名，点击派发 pick-file', async () => {
    const wrapper = mount(MentionPicker, {
      props: {
        open: true,
        stage: 'file',
        directories: DIRS,
        activeDir: 'shared',
        files: [{ filename: 'a.csv' }, { filename: 'b.xlsx' }],
      },
    })
    expect(wrapper.find('.mention-picker__title').text()).toBe('共享空间')
    expect(wrapper.findAll('.mention-picker__item')).toHaveLength(2)

    await wrapper.findAll('.mention-picker__item')[1].trigger('click')
    expect(wrapper.emitted('pick-file')).toEqual([[{ dir: 'shared', filename: 'b.xlsx' }]])
  })

  it('空目录展示空态提示（FR-019）', () => {
    const wrapper = mount(MentionPicker, {
      props: { open: true, stage: 'file', directories: DIRS, activeDir: 'tmp', files: [] },
    })
    expect(wrapper.find('.mention-picker__empty').text()).toBe('该目录暂无文件')
  })

  it('加载中展示加载提示而非空态', () => {
    const wrapper = mount(MentionPicker, {
      props: {
        open: true,
        stage: 'file',
        directories: DIRS,
        activeDir: 'tmp',
        files: [],
        loading: true,
      },
    })
    expect(wrapper.find('.mention-picker__hint').text()).toContain('正在加载')
    expect(wrapper.find('.mention-picker__empty').exists()).toBe(false)
  })

  it('↑/↓ 派发 move 增量', async () => {
    const wrapper = mount(MentionPicker, { props: { open: true, directories: DIRS } })
    const panel = wrapper.find('.mention-picker')

    await panel.trigger('keydown', { key: 'ArrowDown' })
    await panel.trigger('keydown', { key: 'ArrowUp' })
    expect(wrapper.emitted('move')).toEqual([[1], [-1]])
  })

  it('目录阶段回车选中当前高亮目录', async () => {
    const wrapper = mount(MentionPicker, {
      props: { open: true, directories: DIRS, activeIndex: 2 },
    })
    await wrapper.find('.mention-picker').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('pick-dir')).toEqual([['tmp']])
  })

  it('文件阶段回车选中当前高亮文件', async () => {
    const wrapper = mount(MentionPicker, {
      props: {
        open: true,
        stage: 'file',
        directories: DIRS,
        activeDir: 'shared',
        files: [{ filename: 'a.csv' }, { filename: 'b.xlsx' }],
        activeIndex: 1,
      },
    })
    await wrapper.find('.mention-picker').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('pick-file')).toEqual([[{ dir: 'shared', filename: 'b.xlsx' }]])
  })

  it('高亮越界时回车不派发', async () => {
    const wrapper = mount(MentionPicker, {
      props: { open: true, stage: 'file', directories: DIRS, activeDir: 'shared', files: [] },
    })
    await wrapper.find('.mention-picker').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('pick-file')).toBeUndefined()
  })

  it('Esc 派发 close', async () => {
    const wrapper = mount(MentionPicker, { props: { open: true, directories: DIRS } })
    await wrapper.find('.mention-picker').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

})
