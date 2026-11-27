
const CLOSE_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" ' +
  'aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>'

export interface ComposerChipSpec {
  text: string
  removeLabel: string
  attrs: Record<string, string>
  onRemove: (chip: HTMLElement) => void
}

/** 造一枚不可编辑的胶囊（`contenteditable=false`）+ 关闭按钮。 */
export function createComposerChip(spec: ComposerChipSpec): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'composer__mention'
  // 用属性而不是 `contentEditable` 属性赋值：胶囊的不可编辑性必须落在 DOM 属性上
  chip.setAttribute('contenteditable', 'false')
  for (const [name, value] of Object.entries(spec.attrs)) {
    chip.setAttribute(name, value)
  }
  chip.textContent = spec.text

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'composer__mention-remove'
  remove.setAttribute('aria-label', spec.removeLabel)
  remove.innerHTML = CLOSE_ICON
  remove.addEventListener('mousedown', (event) => event.preventDefault())
  remove.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    spec.onRemove(chip)
  })

  chip.appendChild(remove)
  return chip
}
