/**
 * 输入区「胶囊」DOM 工厂（2026-11-17 从 `Composer.vue` 抽出）
 *
 * 引用胶囊与技能胶囊本来就是**同款**：同 class、同关闭按钮图形、同"按下不抢焦点"处理，
 * 差别只在文本与两个属性。抽到一处后，Composer 只描述"这枚胶囊代表什么"，
 * 不再复制一份 DOM 拼装逻辑（同时把组件拉回 500 行门禁内）。
 *
 * 注意：胶囊是 `document.createElement` 造出来的，**没有** scoped 的 `data-v-*` 标记，
 * 所以它的样式必须写在组件里的 `:global(.composer__mention)` 下。
 */

/** 关闭图标：与 `BaseIcon` 的 `close` 同形（contenteditable 子节点只能手工造） */
const CLOSE_ICON =
  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false" ' +
  'aria-hidden="true"><path d="M18 6 6 18"/><path d="M6 6l12 12"/></svg>'

/** 胶囊描述：文本、无障碍标签、附加属性与关闭回调 */
export interface ComposerChipSpec {
  /** 胶囊正文（即参与序列化的标记，如 `@文件名` / `/技能名`） */
  text: string
  /** 关闭按钮的 `aria-label` */
  removeLabel: string
  /** 附加到胶囊上的 DOM 属性（标记类属性由调用方给，序列化依赖它们） */
  attrs: Record<string, string>
  /** 点关闭：拿到胶囊本体，由调用方删节点、还原光标、通知上层 */
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
  // 按下时不让焦点/光标交给按钮：删完仍要在原位继续输入
  remove.addEventListener('mousedown', (event) => event.preventDefault())
  remove.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    spec.onRemove(chip)
  })

  chip.appendChild(remove)
  return chip
}
