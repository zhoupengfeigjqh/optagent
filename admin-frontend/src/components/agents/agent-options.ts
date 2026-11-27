/**
 * 数字人 → 复选框选项的**唯一构造处**（2026-11-27 收敛）。
 *
 * 「新建账户」与「授权详情」此前各写一份逐字相同的映射（`description` 回退文案、
 * 「异常」徽标），卡片列表还有第三份硬编码；改动只应发生在这里一次。
 */
import type { AgentListItem } from '../../api/types'
import type { CheckboxOption } from '../common/checkbox-option'

export function agentCheckboxOptions(agents: AgentListItem[]): CheckboxOption[] {
  return agents.map((agent) => ({
    value: agent.name,
    label: agent.name,
    description: agent.description || '（无描述）',
    badge: agent.abnormal ? '异常' : undefined,
  }))
}
