/**
 * 多选清单的选项模型。
 *
 * 独立成 `.ts` 模块而非从 `.vue` 导出：`<script setup>` 不允许 ES 导出，
 * 而选择器组件需要复用这个类型（原则七：类型唯一来源）。
 */
export interface CheckboxOption {
  value: string
  label: string
  /** 用途说明（如工具的占位符模板） */
  description?: string
  /** 附加标记（如"只读"） */
  badge?: string
  /** 失效项：可见但不可选（`FR-013`） */
  disabled?: boolean
}
