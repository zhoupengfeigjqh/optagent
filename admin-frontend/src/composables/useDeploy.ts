/**
 * 部署（US2）：部署执行与结果。
 *
 * 两条与规格直接对应的约束：
 * 1. **部署对象由「用户与关联数字人」页勾选**（2026-09-16 产品决定）：
 *    `deploy` 接收明确的 `user_ids`，**空选择一律拒绝**——
 *    否则会落回服务端"缺省 = 全部用户"的语义，变成误部署全平台。
 * 2. 乐观锁版本取自**部署清单端点**（2026-09-27）：`目标运行形态` 下架后
 *    不再有 `/platform/settings` 作为 `revision` 来源。
 *
 * **2026-11-23**：部署前预检与全局异常项汇总下架，`validate()` / `validated` /
 * `validationErrors` 一并移除——勾选后即可直接部署；失败原因只从部署响应的
 * `users[].error` 与错误提示中读。
 *
 * **2026-11-23 冗余清理**：`revision` **只在提交前读一次**。部署本身不写平台
 * 设计态（`bumpRevision()` 只在保存数字人/用户/MCP/SKILL/本体时调用，
 * 部署清单走 `writeJson` 不 bump），因此"部署后再读一次"必然拿到同一个值，
 * 属纯多余请求；相应地失败后也不再静默重读——下一次提交前那次读取已经足够。
 * 版本读不到时**直接止步**（不再以 `revision=0` 提交）：否则后端会返回
 * 409「配置已被他人修改」，而真实原因是存储读不到，错误原因会误导管理员。
 */
import { ref, shallowRef } from 'vue'
import { deploy as runDeployApi, fetchManifest } from '../api/deploy'
import type { DeployResult, ErrorInfo } from '../api/types'
import { toErrorInfo } from '../utils/error-message'

/** 空选择时的可读报错（同时兜住"误落到全部用户"这条最危险的路径） */
const NO_TARGET: ErrorInfo = {
  code: 'VALIDATION_FAILED',
  message: '请先在「用户与关联数字人」中勾选要部署的用户',
}

export function useDeploy() {
  /** 平台设计态当前版本（部署的乐观锁基准） */
  const revision = ref<number | null>(null)
  const deploying = ref(false)
  const result = shallowRef<DeployResult | null>(null)
  const error = ref<ErrorInfo | null>(null)
  /** 勾选列表里已被删除的用户（`details.user_ids`）：整批 404 时用于指出是哪些人 */
  const unknownUserIds = ref<string[]>([])

  /**
   * 读取当前版本（部署提交前调用）。
   *
   * 失败时把原因写进 `error` 并保持 `revision` 为 `null`——由 `deploy` 据此止步。
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
    // 部署前**总是**取最新版本（而非仅在未加载时）：用户在别处改过配置后，
    // 本页缓存的旧 revision 已过期，用它提交必被 409 拒绝（2026-11-17）
    await loadRevision()
    const current = revision.value
    // 版本读不到 → 止步。以 `revision=0` 提交必被 409 拒绝，且会把
    // "存储不可用"误报成"配置已被他人修改"（2026-11-23）
    if (current === null) return false

    deploying.value = true
    error.value = null
    unknownUserIds.value = []
    try {
      result.value = await runDeployApi(userIds, current)
      return true
    } catch (err) {
      error.value = toErrorInfo(err)
      // 请求级失败：未知用户要把名单列出来（配置类失败已不在部署前判定，
      // 逐用户失败原因在响应的 `users[].error` 里）
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
