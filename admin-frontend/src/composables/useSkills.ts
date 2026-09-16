/**
 * SKILL 管理（US3）：列表、查看/逐个文件编辑、上传安装、删除。
 *
 * 2026-09-16：**全部文件可编辑**（`SKILL.md` 与 `references/` 等附件），
 * 保存走 `PUT .../file`，以读到的内容哈希作乐观锁。
 */
import { ref, shallowRef } from 'vue'
import {
  deleteSkill,
  fetchSkillFile,
  getSkill,
  installSkill,
  listSkills,
  saveSkillFile,
} from '../api/skills'
import type {
  ErrorInfo,
  Paged,
  SkillDetail,
  SkillFileContent,
  SkillFileSaved,
  SkillInstallResult,
  SkillListItem,
} from '../api/types'
import { toErrorInfo } from '../utils/error-message'

export function useSkills() {
  const page = ref(1)
  const list = shallowRef<Paged<SkillListItem> | null>(null)
  const detail = shallowRef<SkillDetail | null>(null)
  const loading = ref(false)
  const uploading = ref(false)
  const error = ref<ErrorInfo | null>(null)

  async function loadList(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      list.value = await listSkills(page.value)
    } catch (err) {
      error.value = toErrorInfo(err)
    } finally {
      loading.value = false
    }
  }

  async function loadDetail(name: string): Promise<void> {
    error.value = null
    try {
      detail.value = await getSkill(name)
    } catch (err) {
      error.value = toErrorInfo(err)
    }
  }

  /** 读取技能内某个文件；失败返回 null 并写入可读错误 */
  async function loadFile(name: string, path: string): Promise<SkillFileContent | null> {
    error.value = null
    try {
      return await fetchSkillFile(name, path)
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    }
  }

  /**
   * 保存技能内某个文件；失败返回 null 并写入可读错误。
   *
   * `baseHash` 为读取时的哈希：内容已被他处修改时服务端返回冲突，
   * 界面据此提示"刷新后重试"，MUST NOT 静默覆盖。
   */
  async function saveFile(
    name: string,
    path: string,
    content: string,
    baseHash: string,
  ): Promise<SkillFileSaved | null> {
    error.value = null
    try {
      const saved = await saveSkillFile(name, path, content, baseHash)
      // 描述可能随 SKILL.md 正文变化，列表需跟着刷新
      await loadList()
      return saved
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    }
  }

  /** 上传安装；`overwrite` 为真表示**显式选择覆盖**（`FR-040`） */
  async function install(file: File, overwrite: boolean): Promise<SkillInstallResult | null> {
    uploading.value = true
    error.value = null
    try {
      const result = await installSkill(file, overwrite)
      await loadList()
      return result
    } catch (err) {
      error.value = toErrorInfo(err)
      return null
    } finally {
      uploading.value = false
    }
  }

  async function remove(name: string): Promise<boolean> {
    error.value = null
    try {
      await deleteSkill(name)
      await loadList()
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      return false
    }
  }

  return {
    page,
    list,
    detail,
    loading,
    uploading,
    error,
    loadList,
    loadDetail,
    loadFile,
    saveFile,
    install,
    remove,
  }
}
