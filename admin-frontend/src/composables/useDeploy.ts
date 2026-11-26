import { ref, shallowRef } from 'vue'
import { deploy as runDeployApi, fetchManifest, validateDeploy } from '../api/deploy'
import type { DeployResult, DeployValidationError, ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

const NO_TARGET: ErrorInfo = {
  code: 'VALIDATION_FAILED',
  message: '请先在「用户与关联数字人」中勾选要部署的用户',
}

export function useDeploy() {
  const revision = ref<number | null>(null)
  const validating = ref(false)
  const deploying = ref(false)
  const validationErrors = ref<DeployValidationError[]>([])
  const validated = ref(false)
  const result = shallowRef<DeployResult | null>(null)
  const error = ref<ErrorInfo | null>(null)
  const unknownUserIds = ref<string[]>([])

  /**
   * 读取当前版本（页面进入、以及每次部署后刷新，避免下一次调用版本冲突）。
   *
   * `silent`：失败时不覆盖 `error`——部署失败后刷新版本属于收尾动作，
   * 不能把"部署为什么失败"替换成"版本读取失败"（2026-10-20）。
   */
  async function loadRevision(options?: { silent?: boolean }): Promise<void> {
    try {
      revision.value = (await fetchManifest()).revision
    } catch (err) {
      if (!options?.silent) error.value = toErrorInfo(err)
    }
  }

  function invalidateValidation(): void {
    validationErrors.value = []
    validated.value = false
  }

  async function validate(userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      error.value = NO_TARGET
      return
    }
    validating.value = true
    error.value = null
    unknownUserIds.value = []
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
    await loadRevision()
    deploying.value = true
    error.value = null
    unknownUserIds.value = []
    try {
      result.value = await runDeployApi(userIds, revision.value ?? 0)
      validationErrors.value = []
      validated.value = false
      await loadRevision()
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      const details = (err as { details?: unknown }).details as
        { errors?: DeployValidationError[]; user_ids?: string[] } | undefined
      if (details?.errors) validationErrors.value = details.errors
      unknownUserIds.value = Array.isArray(details?.user_ids) ? details.user_ids : []
      await loadRevision({ silent: true })
      return false
    } finally {
      deploying.value = false
    }
  }

  return {
    revision,
    validating,
    deploying,
    validationErrors,
    validated,
    result,
    error,
    unknownUserIds,
    loadRevision,
    invalidateValidation,
    validate,
    deploy,
  }
}
