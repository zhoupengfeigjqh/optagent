/**
 * 单元测试：SKILL 管理状态（US3）
 *
 * 覆盖列表 / 详情 / **单文件读取与保存**（2026-09-16 起全部文件可编辑）/
 * 上传安装 / 冲突 / 删除，以及每条失败路径的错误归一。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSkills } from './useSkills'

const listSkills = vi.fn()
const getSkill = vi.fn()
const fetchSkillFile = vi.fn()
const saveSkillFile = vi.fn()
const installSkill = vi.fn()
const deleteSkill = vi.fn()

vi.mock('../api/skills', () => ({
  listSkills: (...a: unknown[]) => listSkills(...a),
  getSkill: (...a: unknown[]) => getSkill(...a),
  fetchSkillFile: (...a: unknown[]) => fetchSkillFile(...a),
  saveSkillFile: (...a: unknown[]) => saveSkillFile(...a),
  installSkill: (...a: unknown[]) => installSkill(...a),
  deleteSkill: (...a: unknown[]) => deleteSkill(...a),
}))

const DETAIL = {
  name: 'pdf-parse',
  description: '解析 PDF',
  content: '---\nname: pdf-parse\ndescription: 解析 PDF\n---\n\n正文\n',
  content_hash: 'hash-of-skill-md',
  files: [],
  source: 'a.zip',
  installed_at: 'x',
  updated_at: 'y',
  revision: 4,
}

const SAVED = {
  name: 'pdf-parse',
  path: 'references/手册.md',
  size: 12,
  hash: 'new-hash',
  updated_at: 'z',
  revision: 5,
}

beforeEach(() => {
  listSkills.mockReset().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 8, total_pages: 0 })
  getSkill.mockReset().mockResolvedValue(DETAIL)
  fetchSkillFile.mockReset()
  saveSkillFile.mockReset()
  installSkill.mockReset()
  deleteSkill.mockReset()
})

describe('useSkills', () => {
  it('loadList：写入分页结果', async () => {
    listSkills.mockResolvedValue({ items: [DETAIL], total: 1, page: 1, page_size: 8, total_pages: 1 })
    const skills = useSkills()
    await skills.loadList()
    expect(skills.list.value?.total).toBe(1)
    expect(skills.loading.value).toBe(false)
  })

  it('loadList 失败：错误被归一且不抛出', async () => {
    listSkills.mockRejectedValue({ code: 'ADM_STORAGE_UNAVAILABLE', message: 'x' })
    const skills = useSkills()
    await skills.loadList()
    expect(skills.error.value?.code).toBe('ADM_STORAGE_UNAVAILABLE')
  })

  it('loadDetail：写入详情', async () => {
    const skills = useSkills()
    await skills.loadDetail('pdf-parse')
    expect(skills.detail.value?.name).toBe('pdf-parse')
    expect(getSkill).toHaveBeenCalledWith('pdf-parse')
  })

  it('loadDetail 失败：错误可读、详情保持为空', async () => {
    getSkill.mockRejectedValue({ code: 'ADM_SKILL_NOT_FOUND', message: 'x' })
    const skills = useSkills()
    await skills.loadDetail('ghost')
    expect(skills.error.value?.code).toBe('ADM_SKILL_NOT_FOUND')
    expect(skills.detail.value).toBeNull()
  })

  it('loadFile：读回单个文件内容与哈希（2026-09-16）', async () => {
    fetchSkillFile.mockResolvedValue({
      name: 'pdf-parse',
      path: 'references/手册.md',
      size: 12,
      binary: false,
      truncated: false,
      content: '# 手册\n',
      hash: 'h1',
      editable: true,
    })
    const skills = useSkills()

    const file = await skills.loadFile('pdf-parse', 'references/手册.md')
    expect(fetchSkillFile).toHaveBeenCalledWith('pdf-parse', 'references/手册.md')
    expect(file?.content).toBe('# 手册\n')
    expect(file?.hash).toBe('h1')
    expect(skills.error.value).toBeNull()
  })

  it('loadFile 失败：返回 null 并保留可读错误（详情页据此提示）', async () => {
    fetchSkillFile.mockRejectedValue({ code: 'ADM_SKILL_NOT_FOUND', message: '技能内不存在该文件' })
    const skills = useSkills()

    expect(await skills.loadFile('pdf-parse', 'nope.md')).toBeNull()
    expect(skills.error.value?.code).toBe('ADM_SKILL_NOT_FOUND')
  })

  it('saveFile：携带 base_hash 保存并刷新列表（描述可能随 SKILL.md 变化）', async () => {
    saveSkillFile.mockResolvedValue(SAVED)
    const skills = useSkills()

    const saved = await skills.saveFile('pdf-parse', 'references/手册.md', '# 新手册\n', 'h1')

    expect(saveSkillFile).toHaveBeenCalledWith('pdf-parse', 'references/手册.md', '# 新手册\n', 'h1')
    expect(saved?.hash).toBe('new-hash')
    expect(listSkills).toHaveBeenCalled()
    expect(skills.error.value).toBeNull()
  })

  it('saveFile 冲突：返回 null 并保留 ADM_CONFIG_REVISION_CONFLICT（界面提示刷新后重试）', async () => {
    saveSkillFile.mockRejectedValue({
      code: 'ADM_CONFIG_REVISION_CONFLICT',
      message: '文件已被他处修改',
    })
    const skills = useSkills()

    expect(await skills.saveFile('pdf-parse', 'SKILL.md', 'x', 'stale')).toBeNull()
    expect(skills.error.value?.code).toBe('ADM_CONFIG_REVISION_CONFLICT')
  })

  it('install：成功返回结果并刷新列表；overwrite 透传（FR-040）', async () => {
    installSkill.mockResolvedValue({ name: 'pdf-parse', description: '', files: [], installed_at: 'x', overwritten: true })
    const skills = useSkills()
    const result = await skills.install(new File(['PK'], 'a.zip'), true)

    expect(installSkill).toHaveBeenCalledWith(expect.any(File), true)
    expect(result?.overwritten).toBe(true)
    expect(listSkills).toHaveBeenCalled()
  })

  it('install 失败：错误可读（名称冲突交由界面显式选择覆盖）', async () => {
    installSkill.mockRejectedValue({ code: 'ADM_SKILL_NAME_TAKEN', message: 'x' })
    const skills = useSkills()
    expect(await skills.install(new File(['PK'], 'a.zip'), false)).toBeNull()
    expect(skills.error.value?.code).toBe('ADM_SKILL_NAME_TAKEN')
    expect(skills.uploading.value).toBe(false)
  })

  it('remove：成功返回 true 并刷新列表', async () => {
    deleteSkill.mockResolvedValue(undefined)
    const skills = useSkills()
    expect(await skills.remove('pdf-parse')).toBe(true)
    expect(listSkills).toHaveBeenCalled()
  })

  it('remove 失败：返回 false 并保留错误', async () => {
    deleteSkill.mockRejectedValue({ code: 'ADM_SKILL_NOT_FOUND', message: 'x' })
    const skills = useSkills()
    expect(await skills.remove('ghost')).toBe(false)
    expect(skills.error.value?.code).toBe('ADM_SKILL_NOT_FOUND')
  })
})
