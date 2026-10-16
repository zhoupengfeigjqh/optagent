/**
 * 浏览器下载（2026-10-16）。
 *
 * 会话导出等"纯文本落地"共用这一处：`Blob` + 临时 `<a download>` + 对象 URL。
 * 单独成文件，是为了让 `export-thread.ts` 保持纯函数——文本怎么拼可以直接断言，
 * DOM 这一跳只在这一处发生。
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime = 'text/markdown;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // 立刻撤销会让部分浏览器来不及取数据，放到下一轮任务里
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
