/**
 * 组件测试：本体详情只读视图（`FR-059`）
 *
 * 守住四条（2026-10-03 改为「左文件列表 + 右只读正文」，形态与样式逐项对齐 SKILL 详情）：
 * 1. 默认展示 `ontology.yaml` **全文**（`<pre>`）；右侧头部为「mono 路径 + 大小 + 「只读」徽标」，
 *    元数据为两列 `dl`（场景 / 本体 / 创建时间 / 部署版本 / 来源 / 安装·更新 / 文件 / 修改方式）；
 * 2. 已同步 `securities.yaml` 时左侧出现两个文件、**可切换**（切换不发请求，两个文件都在详情里）；
 *    未同步时左侧只有本体正文一行，并在元数据「文件」行说明"市场侧未配置安全管控"；
 * 3. **只读**：组件内不存在任何输入控件（`input`/`textarea`/`contenteditable`）与保存按钮；
 * 4. 删除走二次确认，成功后 emit `deleted`；失败留在页内且不 emit。
 */
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
    scenario: '生产调度',
    ontology_dir: '原材料采购和库存',
    name: '原材料采购和库存',
    metadata: {
      created_at: '2026-07-15 16:05:02',
      deployed_version: 'v1.0',
      scenario_name: '生产调度',
      scenario_id: 1,
      ontology_name: '原材料采购和库存',
      ontology_id: 1,
    },
    source: 'onto_market:生产调度',
    hash: 'h1',
    has_securities: false,
    installed_at: '2026-10-03T00:00:00.000Z',
    updated_at: '2026-10-03T00:00:00.000Z',
    content: YAML,
    size: YAML.length,
    securities_content: null,
    securities_size: 0,
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

/** 左侧文件树里的文件按钮（按可见文本定位，与 SKILL 详情同一套写法） */
function fileButton(wrapper: ReturnType<typeof mountViewer>, label: string) {
  return wrapper.findAll('button').find((button) => button.text() === label)
}

describe('OntologyViewer —— 只读展示（左文件列表 + 右正文）', () => {
  it('默认展示 ontology.yaml 全文与元数据（路径 + 大小 + 「只读」徽标）', () => {
    const wrapper = mountViewer()

    // 用 textContent 而非 text()：后者会折叠空白，逐字符比对会失真
    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(YAML)
    const head = wrapper.find('[data-test="file-head"]').text()
    expect(head).toContain('ontology.yaml')
    expect(head).toContain('只读')
    expect(head).toContain(`${YAML.length} B`)
    // 元数据两列 dl：场景 / 本体 / 创建时间 / 部署版本 / 来源 / 安装·更新 / 文件 / 修改方式
    expect(wrapper.text()).toContain('2026-07-15 16:05:02')
    expect(wrapper.text()).toContain('生产调度（ID 1）')
    expect(wrapper.text()).toContain('onto_market:生产调度')
    expect(wrapper.text()).toContain('本体是市场快照，平台只读')
  })

  it('MUST 无任何编辑控件：没有 input/textarea/contenteditable，也没有保存按钮', () => {
    const wrapper = mountViewer()

    expect(wrapper.findAll('input, textarea, [contenteditable]')).toHaveLength(0)
    expect(wrapper.text()).not.toContain('保存')
  })

  it('已同步 securities.yaml → 左侧两个文件、可切换；切换后展示其全文与大小', async () => {
    const wrapper = mountViewer(
      detail({
        has_securities: true,
        securities_content: SECURITIES,
        securities_size: SECURITIES.length,
      }),
    )

    // 左侧列表：两个文件都在
    expect(fileButton(wrapper, 'ontology.yaml')).toBeTruthy()
    expect(fileButton(wrapper, 'securities.yaml')).toBeTruthy()
    expect(wrapper.find('[data-test="file-head"]').text()).toContain('ontology.yaml')

    await fileButton(wrapper, 'securities.yaml')!.trigger('click')

    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(SECURITIES)
    const head = wrapper.find('[data-test="file-head"]').text()
    expect(head).toContain('securities.yaml')
    expect(head).toContain(`${SECURITIES.length} B`)
    // 切回本体正文
    await fileButton(wrapper, 'ontology.yaml')!.trigger('click')
    expect(wrapper.find('[data-test="file-content"]').element.textContent).toBe(YAML)
  })

  it('未同步 securities.yaml → 左侧只有本体正文一行，元数据「文件」行说明"市场侧未配置"', () => {
    const wrapper = mountViewer()

    expect(fileButton(wrapper, 'ontology.yaml')).toBeTruthy()
    expect(fileButton(wrapper, 'securities.yaml')).toBeUndefined()
    expect(wrapper.text()).toContain('仅 ontology.yaml（市场侧未配置安全管控）')
  })

  it('已同步时元数据「文件」行标出两个文件（均已同步）', () => {
    const wrapper = mountViewer(
      detail({
        has_securities: true,
        securities_content: SECURITIES,
        securities_size: SECURITIES.length,
      }),
    )

    expect(wrapper.text()).toContain('ontology.yaml + securities.yaml（均已同步）')
  })

  it('点「返回」发出 back', async () => {
    const wrapper = mountViewer()
    await wrapper.find('[data-test="back"]').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})

describe('OntologyViewer —— 删除', () => {
  it('二次确认后删除：按 (目录名, 场景) 调用并 emit deleted', async () => {
    deleteOntology.mockResolvedValue(undefined)
    const wrapper = mountViewer()

    await wrapper.find('[data-test="delete"]').trigger('click')
    expect(wrapper.find('[data-test="confirm"]').exists()).toBe(true)

    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(deleteOntology).toHaveBeenCalledWith('原材料采购和库存', '生产调度')
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
