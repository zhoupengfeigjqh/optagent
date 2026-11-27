export interface CheckboxOption {
  value: string
  label: string
  description?: string
  badge?: string
  /** 失效项：可见但不可选（`FR-013`） */
  disabled?: boolean
}
