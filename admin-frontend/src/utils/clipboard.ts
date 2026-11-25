/**
 * 剪贴板复制（028 §4.3 修复）：`navigator.clipboard` 只在安全上下文
 * （HTTPS 或 localhost）可用——局域网 `http://IP:端口` 访问管理台时不存在，
 * 一律静默失败会让「复制」按钮看似无效。
 *
 * 策略：优先 Clipboard API → 降级 `execCommand('copy')`（老但覆盖非安全上下文）
 * → 仍失败返回 `false`，由调用方给出「手动复制」兜底 UI。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 权限拒绝等 → 走降级路径 */
  }
  return legacyCopy(text);
}

/** 降级路径：临时 textarea + execCommand（需在用户手势调用栈内才生效） */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let ok: boolean;
  try {
    ok = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}
