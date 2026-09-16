/**
 * 部署（US2）：目标运行形态、预检、部署执行与结果。
 *
 * 四条与规格直接对应的约束：
 * 1. 目标运行形态**由服务端提供枚举**，前端 MUST NOT 硬编码（原则七）；
 * 2. 部署前 MUST 先能拿到**一次性列出的全部错误项**（`SC-020`）；
 * 3. 切换运行形态属破坏性操作 → 需二次确认（`FR-057`、`FR-007`）；
 * 4. **部署对象由「用户与关联数字人」页勾选**（2026-09-16 产品决定）：
 *    `validate`/`deploy` 接收明确的 `user_ids`，**空选择一律拒绝**——
 *    否则会落回服务端"缺省 = 全部用户"的语义，变成误部署全平台。
 *    勾选或形态一变，上一次预检结论即作废（否则会"用 A 的结论部署 B"）。
 */
import { computed, ref, shallowRef } from 'vue'
import { fetchRuntimeForms, fetchSettings, saveSettings } from '../api/platform'
import { deploy as runDeployApi, validateDeploy } from '../api/deploy'
import type {
  DeployResult,
  DeployValidationError,
  ErrorInfo,
  PlatformSettings,
  RuntimeFormOption,
} from '../api/types'
import { toErrorInfo } from '../utils/error-message'

/** 空选择时的可读报错（同时兜住"误落到全部用户"这条最危险的路径） */
const NO_TARGET: ErrorInfo = {
  code: 'VALIDATION_FAILED',
  message: '请先在「用户与关联数字人」中勾选要部署的用户',
}

export function useDeploy() {
  const settings = shallowRef<PlatformSettings | null>(null)
  const forms = ref<RuntimeFormOption[]>([])
  const validating = ref(false)
  const deploying = ref(false)
  const validationErrors = ref<DeployValidationError[]>([])
  const validated = ref(false)
  const result = shallowRef<DeployResult | null>(null)
  const error = ref<ErrorInfo | null>(null)

  const targetFormLabel = computed(
    () => forms.value.find((f) => f.value === settings.value?.target_runtime_form)?.label ?? '—',
  )

  async function loadSettings(): Promise<void> {
    try {
      settings.value = await fetchSettings()
      forms.value = (await fetchRuntimeForms()).items
    } catch (err) {
      error.value = toErrorInfo(err)
    }
  }

  /**
   * 作废已预检状态。
   *
   * 部署对象或目标形态一变，上一次结论就**不再适用**。服务端在部署时仍会重新校验
   * （所以不会真的写错），但界面若继续显示"已预检"，"先预检再部署"就成了假承诺。
   */
  function invalidateValidation(): void {
    validationErrors.value = []
    validated.value = false
  }

  /** 只读预检（`FR-027`）：不改动任何部署产物；`userIds` = 界面勾选的部署对象 */
  async function validate(userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      error.value = NO_TARGET
      return
    }
    validating.value = true
    error.value = null
    try {
      const res = await validateDeploy(userIds)
      validationErrors.value = res.errors
      validated.value = true
    } catch (err) {
      error.value = toErrorInfo(err)
    } finally {
      validating.value = false
    }
  }

  async function deploy(userIds: string[]): Promise<boolean> {
    if (userIds.length === 0) {
      error.value = NO_TARGET
      return false
    }
    if (settings.value === null) await loadSettings()
    deploying.value = true
    error.value = null
    try {
      result.value = await runDeployApi(userIds, settings.value?.revision ?? 0)
      validationErrors.value = []
      validated.value = false
      // 部署可能改变 revision（清单/历史写入），刷新以便下次调用不冲突
      await loadSettings()
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      // 校验类失败：把 details.errors 一次列全（SC-020）
      const details = (err as { details?: unknown }).details as
        | { errors?: DeployValidationError[] }
        | undefined
      if (details?.errors) validationErrors.value = details.errors
      return false
    } finally {
      deploying.value = false
    }
  }

  /** 切换目标运行形态（`FR-057`）；调用方 MUST 先做二次确认 */
  async function switchForm(form: string): Promise<boolean> {
    error.value = null
    try {
      const next = await saveSettings(form, settings.value?.revision ?? 0)
      settings.value = { target_runtime_form: next.target_runtime_form, revision: next.revision }
      // 形态变了 → 第⑤类校验（运行形态地址齐备）的结论随之改变，必须重新预检
      invalidateValidation()
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      return false
    }
  }

  return {
    settings,
    forms,
    validating,
    deploying,
    validationErrors,
    validated,
    result,
    error,
    targetFormLabel,
    loadSettings,
    invalidateValidation,
    validate,
    deploy,
    switchForm,
  }
}
