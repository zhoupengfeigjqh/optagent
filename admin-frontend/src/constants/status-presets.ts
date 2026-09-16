/**
 * 状态词典：状态标识 → { 中文名, 语义色, 图标 }。
 *
 * 集中一处，使"状态"在各功能区（MCP 四态、校验通过/失败、配置已/未完成）
 * 呈现一致，并保证**图标 + 文本双通道**（原则四：不得只靠颜色区分状态）。
 */
export type BadgeTone = 'success' | 'error' | 'warning' | 'neutral'

export interface StatusPreset {
  label: string
  tone: BadgeTone
  icon: string
}

export const STATUS_PRESETS: Readonly<Record<string, StatusPreset>> = {
  running: { label: '运行中', tone: 'success', icon: '✓' },
  stopped: { label: '已停止', tone: 'neutral', icon: '■' },
  abnormal: { label: '异常', tone: 'error', icon: '!' },
  unknown: { label: '未知', tone: 'neutral', icon: '?' },

  ok: { label: '正常', tone: 'success', icon: '✓' },
  failed: { label: '失败', tone: 'error', icon: '✕' },
  configured: { label: '已配置', tone: 'success', icon: '✓' },
  unconfigured: { label: '未配置', tone: 'warning', icon: '!' },
  available: { label: '可用', tone: 'success', icon: '✓' },
  unavailable: { label: '不可用', tone: 'error', icon: '✕' },
  written: { label: '已写入', tone: 'success', icon: '✓' },
  removed: { label: '已移除', tone: 'neutral', icon: '−' },
}
