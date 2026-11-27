import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OntologyViewer from './OntologyViewer.vue'
import type { OntologyDetail } from '../../api/ontologies'

const deleteOntology = vi.fn()

vi.mock('../../api/ontologies', () => ({
  deleteOntology: (...a: unknown[]) => deleteOntology(...a),
}))

const YAML = 'metadata:\n  deployed_version: v1.0\nconcepts: []\n'
const SECURITIES = 'securities:\n- action_name: CreatePurchaseRecord\n  confirm: true\n'

function detail(overrides: Partial<OntologyDetail> = {}): OntologyDetail {
  return {
    metadata: {
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: '生产调度',
      scenario_id: 1,
      ontology_name: '原材料采购和库存',
      ontology_id: 1,
    },
    ontology_hash: 'h1',
    installed_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z',
    content: YAML,
    size: YAML.length,
    securities_content: SECURITIES,
    securities_size: SECURITIES.length,
    revision: 3,
    ...overrides,
  }
}

function mountViewer(ontology: OntologyDetail | null = detail()) {
  return mount(OntologyViewer, { props: { ontology, error: null } })
}

beforeEach(() => {
  deleteOntology.mockReset()
})

function fileButton(wrapper: ReturnType<typeof mountViewer>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)
}

describe('OntologyViewer —— 只读展示（左文件列表 + 右正文）', () => {
  it('默认展示 ontology.yaml 全文与元数据（路径 + 大小 + 「只读」徽标）', () => {
    const wrapper = mountViewer()

    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(YAML)
    const head = wrapper.find('[data-test="file-head"]').text()
    expect(head).toContain('ontology.yaml')
    expect(head).toContain('只读')
    expect(head).toContain(`${YAML.length} B`)
    expect(wrapper.find('#ontology-viewer-title').text()).toBe('生产调度-原材料采购和库存')
    expect(wrapper.text()).toContain('2026-07-15 16:05:02')
    expect(wrapper.text()).toContain('生产调度（ID 1）')
    expect(wrapper.text()).toContain('本体市场')
    expect(wrapper.text()).toContain('本体是市场快照，平台只读')
  })

  it('MUST 无任何编辑控件：没有 input/textarea/contenteditable，也没有保存按钮', () => {
    const wrapper = mountViewer()

    expect(wrapper.findAll('input, textarea, [contenteditable]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('保存')
  })

  it('securities.yaml 恒在左侧、可切换；切换后展示其全文与大小', async () => {
    const wrapper = mountViewer()

    expect(fileButton(wrapper, 'ontology.yaml')).toBeTruthy()
    expect(fileButton(wrapper, 'securities.yaml')).toBeTruthy()
    expect(wrapper.find('[data-test="file-head"]').text()).toContain('ontology.yaml')

    await fileButton(wrapper, 'securities.yaml')!.trigger('click')

    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(SECURITIES)
    const head = wrapper.find('[data-test="file-head"]').text()
    expect(head).toContain('securities.yaml')
    expect(head).toContain(`${SECURITIES.length} B`)
    await fileButton(wrapper, 'ontology.yaml')!.trigger('click')
    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(YAML)
  })

  it('元数据「文件」行恒标出两个文件（均已同步）', () => {
    const wrapper = mountViewer()

    expect(wrapper.text()).toContain('ontology.yaml + securities.yaml（均已同步）')
  })

  it('点「返回」发出 back', async () => {
    const wrapper = mountViewer()
    await wrapper.find('[data-test="back"]').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})

describe('OntologyViewer —— 删除', () => {
  it('二次确认后删除：按 (场景名, 本体名) 调用并 emit deleted', async () => {
    deleteOntology.mockResolvedValue(undefined)
    const wrapper = mountViewer()

    await wrapper.find('[data-test="delete"]').trigger('click')
    expect(wrapper.find('[data-test="confirm"]').exists()).toBe(true)
    // 二次确认里同样用 `{场景名}-{本体名}`，避免删错同名本体
    expect(wrapper.text()).toContain('删除本体 生产调度-原材料采购和库存')

    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(deleteOntology).toHaveBeenCalledWith('生产调度', '原材料采购和库存')
    expect(wrapper.emitted('deleted')).toHaveLength(1)
  })

  it('删除失败：错误留在页内，MUST NOT emit deleted', async () => {
    deleteOntology.mockRejectedValue({ code: 'ADM_ONTOLOGY_NOT_FOUND', message: '本体不存在' })
    const wrapper = mountViewer()

    await wrapper.find('[data-test="delete"]').trigger('click')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('deleted')).toBeUndefined()
    expect(wrapper.text()).toContain('ADM_ONTOLOGY_NOT_FOUND')
  })
})
