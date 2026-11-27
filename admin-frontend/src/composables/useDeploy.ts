import { ref, shallowRef } from 'vue'
import { deploy as runDeployApi, fetchManifest } from '../api/deploy'
import type { DeployResult, ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

const NO_TARGET: ErrorInfo = {
  code: 'VALIDATION_FAILED',
  message: '请先在「用户与关联数字人」中勾选要部署的用户',
}

export function useDeploy() {
  const revision = ref<number | null>(null)
  const deploying = ref(false)
  const result = shallowRef<DeployResult | null>(null)
  const error = ref<ErrorInfo | null>(null)
  const unknownUserIds = ref<string[]>([])

  /**
   *
   */
  async function loadRevision(): Promise<void> {
    try {
      revision.value = (await fetchManifest()).revision
    } catch (err) {
      revision.value = null
      error.value = toErrorInfo(err)
    }
  }

  async function deploy(userIds: string[]): Promise<boolean> {
    if (userIds.length === 0) {
      error.value = NO_TARGET
      return false
    }
    await loadRevision()
    const current = revision.value
    if (current === null) return false
    deploying.value = true
    error.value = null
    unknownUserIds.value = []
    try {
      result.value = await runDeployApi(userIds, current)
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      const details = (err as { details?: unknown }).details as { user_ids?: string[] } | undefined
      unknownUserIds.value = Array.isArray(details?.user_ids) ? details.user_ids : []
      return false
    } finally {
      deploying.value = false
    }
  }

  return {
    revision,
    deploying,
    result,
    error,
    unknownUserIds,
    loadRevision,
    deploy,
  }
}
