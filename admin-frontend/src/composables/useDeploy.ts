/**
 * 部署（US2）：预检、部署执行与结果。
 *
 * 三条与规格直接对应的约束：
 * 1. 部署前 MUST 先能拿到**一次性列出的全部错误项**（`SC-020`）；
 * 2. **部署对象由「用户与关联数字人」页勾选**（2026-09-16 产品决定）：
 *    `validate`/`deploy` 接收明确的 `user_ids`，**空选择一律拒绝**——
 *    否则会落回服务端"缺省 = 全部用户"的语义，变成误部署全平台。
 *    勾选一变，上一次预检结论即作废（否则会"用 A 的结论部署 B"）。
 * 3. 乐观锁版本取自 **部署清单端点**（2026-09-27）：`目标运行形态` 下架后
 *    不再有 `/platform/settings` 作为 `revision` 来源。
 */
import { ref, shallowRef } from 'vue'
import { deploy as runDeployApi, fetchManifest, validateDeploy } from '../api/deploy'
import type { DeployResult, DeployValidationError, ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

/** 空选择时的可读报错（同时兜住"误落到全部用户"这条最危险的路径） */
const NO_TARGET: ErrorInfo = {
  code: 'VALIDATION_FAILED',
  message: '请先在「用户与关联数字人」中勾选要部署的用户',
}

export function useDeploy() {
  /** 平台设计态当前版本（部署的乐观锁基准） */
  const revision = ref<number | null>(null)
  const validating = ref(false)
  const deploying = ref(false)
  const validationErrors = ref<DeployValidationError[]>([])
  const validated = ref(false)
  const result = shallowRef<DeployResult | null>(null)
  const error = ref<ErrorInfo | null>(null)
  /** 勾选列表里已被删除的用户（`details.user_ids`）：整批 404 时用于指出是哪些人 */
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

  /**
   * 作废已预检状态。
   *
   * 部署对象一变，上一次结论就**不再适用**。服务端在部署时仍会重新校验
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
    if (revision.value === null) await loadRevision()
    deploying.value = true
    error.value = null
    unknownUserIds.value = []
    try {
      result.value = await runDeployApi(userIds, revision.value ?? 0)
      validationErrors.value = []
      validated.value = false
      // 部署本身不改 revision，但仍刷新一次：拿到的是"当前最新"，下次调用不会被陈旧版本卡住
      await loadRevision()
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      // 校验类失败：把 details.errors 一次列全（SC-020）；未知用户：把名单列出来
      const details = (err as { details?: unknown }).details as
        { errors?: DeployValidationError[]; user_ids?: string[] } | undefined
      if (details?.errors) validationErrors.value = details.errors
      unknownUserIds.value = Array.isArray(details?.user_ids) ? details.user_ids : []
      // 失败原因可能正是"版本已被他处修改"：静默刷新，保证同页重试时用的是最新版本
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
