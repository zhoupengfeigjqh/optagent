/**
 * 测试用 multipart/form-data 构造器（零依赖）。
 *
 * `app.inject` 接受原始 buffer + Content-Type，因此这里手工拼装即可，
 * 不必引入表单库（原则六）。
 */
export interface MultipartPayload {
  payload: Buffer
  headers: Record<string, string>
}

export function multipartBody(
  fields: Record<string, string>,
  file: { name: string; content: Buffer; contentType?: string },
): MultipartPayload {
  const boundary = `----optagent-test-boundary-${Date.now()}`
  const chunks: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }

  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.contentType ?? 'application/zip'}\r\n\r\n`,
      'utf8',
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'),
  )

  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  }
}
