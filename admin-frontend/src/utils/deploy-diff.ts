/**
 * 部署差异项的一行文字（**唯一实现**，2026-11-23 归一）。
 *
 * 同一个结构在两处呈现过两种格式：部署结果只给"说明"，部署历史给
 * "用户 / 数字人：说明"。现统一为后者——差异项的必要信息是**谁**和**什么**，
 * 只给"什么"时管理员还得回头对照用户。
 *
 * `detail` 缺失时回退到 `kind`（差异类型），再缺则留空——三者都不做类型断言，
 * 脏数据不会让渲染抛错。
 */
import type { DeployManifestDiffEntry } from '../api/types'

export function diffText(diff: DeployManifestDiffEntry): string {
  const target = diff.target ? ` / ${diff.target}` : ''
  return `${diff.user_id}${target}：${diff.detail || diff.kind || ''}`
}
