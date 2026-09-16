/**
 * 组件测试：SKILL 上传对话框（T096）
 *
 * 覆盖 `FR-037`~`FR-041` 的界面分支：未选文件、安装成功、
 * 失败原因可读、**名称冲突要求显式选择覆盖或取消**。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SkillUploadDialog from './SkillUploadDialog.vue'

const installSkill = vi.fn()
const fetchReferences = vi.fn()

vi.mock('../../api/skills', () => ({
  installSkill: (...a: unknown[]) => installSkill(...a),
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  saveSkillContent: vi.fn(),
  deleteSkill: vi.fn(),
}))

vi.mock('../../api/deploy', () => ({
  fetchReferences: (...a: unknown[]) => fetchReferences(...a),
  fetchAnomalies: vi.fn(),
  validateDeploy: vi.fn(),
  deploy: vi.fn(),
  fetchDeployHistory: vi.fn(),
  fetchManifest: vi.fn(),
}))

function mountDialog(open = true) {
  return mount(SkillUploadDialog, { props: { open } })
}

const FILE = new File(['PK'], 'pdf-parse.zip', { type: 'application/zip' })

beforeEach(() => {
  installSkill.mockReset()
  fetchReferences.mockReset().mockResolvedValue({ affected: [] })
})

describe('SkillUploadDialog', () => {
  it('open 为 false 时不打开', () => {
    expect(mountDialog(false).find('dialog').attributes('open')).toBeUndefined()
  })

  it('未选文件即提交 → 可读提示，且不调用接口', async () => {
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(installSkill).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请先选择 ZIP 文件')
  })

  it('安装成功发出 installed 并关闭', async () => {
    installSkill.mockResolvedValue({
      name: 'pdf-parse',
      description: '解析 PDF',
      files: [],
      installed_at: '2026-09-15T00:00:00.000Z',
      overwritten: false,
    })
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    await wrapper.find('input[type="file"]').trigger('change')
    Object.defineProperty(wrapper.find('input[type="file"]').element, 'files', { value: [FILE] })
    await wrapper.find('input[type="file"]').trigger('change')

    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(installSkill).toHaveBeenCalledWith(FILE, false)
    expect(wrapper.emitted('installed')).toHaveLength(1)
  })

  it('失败原因按错误码给出可读文案（格式不合法）', async () => {
    installSkill.mockRejectedValue({ code: 'ADM_SKILL_ARCHIVE_INVALID', message: 'raw' })
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    Object.defineProperty(wrapper.find('input[type="file"]').element, 'files', { value: [FILE] })
    await wrapper.find('input[type="file"]').trigger('change')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('压缩包格式不符')
  })

  it('安全校验失败原因可读（越界/符号链接/超限）', async () => {
    installSkill.mockRejectedValue({ code: 'ADM_SKILL_ARCHIVE_UNSAFE', message: 'raw' })
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    Object.defineProperty(wrapper.find('input[type="file"]').element, 'files', { value: [FILE] })
    await wrapper.find('input[type="file"]').trigger('change')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('压缩包存在安全风险')
  })

  it('名称冲突：不静默覆盖，而是要求「覆盖」或「取消」（FR-040）', async () => {
    installSkill.mockRejectedValue({ code: 'ADM_SKILL_NAME_TAKEN', message: 'raw' })
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    Object.defineProperty(wrapper.find('input[type="file"]').element, 'files', { value: [FILE] })
    await wrapper.find('input[type="file"]').trigger('change')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    const dialogs = wrapper.findAll('dialog')
    const conflict = dialogs[dialogs.length - 1]!
    expect(conflict.attributes('open')).toBeDefined()
    expect(conflict.text()).toContain('库中已有同名 SKILL')
    expect(conflict.find('[data-test="confirm"]').text()).toBe('覆盖')
    expect(conflict.find('[data-test="cancel"]').text()).toBe('取消')
  })

  it('选择覆盖后以 overwrite=true 重新提交', async () => {
    installSkill
      .mockRejectedValueOnce({ code: 'ADM_SKILL_NAME_TAKEN', message: 'raw' })
      .mockResolvedValueOnce({
        name: 'pdf-parse',
        description: 'x',
        files: [],
        installed_at: '2026-09-15T00:00:00.000Z',
        overwritten: true,
      })
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    Object.defineProperty(wrapper.find('input[type="file"]').element, 'files', { value: [FILE] })
    await wrapper.find('input[type="file"]').trigger('change')
    await wrapper.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    const dialogs = wrapper.findAll('dialog')
    await dialogs[dialogs.length - 1]!.find('[data-test="confirm"]').trigger('click')
    await flushPromises()

    expect(installSkill).toHaveBeenLastCalledWith(FILE, true)
  })

  it('说明"失败不会留下残留"与上限口径（FR-039、FR-041）', async () => {
    const wrapper = mountDialog()
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('符号链接')
    expect(wrapper.text()).toContain('不会留下任何残留')
  })
})
