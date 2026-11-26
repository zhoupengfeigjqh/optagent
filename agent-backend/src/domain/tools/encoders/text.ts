
export function encodeText(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

/**
 * JSON：必须是完整可解析的文档。
 *
 * 只做**放行判定**，不改写内容——重排会让"我提交的"与"文件里的"不一致，
 * 模型回读时会困惑；校验的目的只有一个：别落一个打不开的文件。
 */
export function validateJson(content: string): string | null {
  if (content.trim() === '') {
    return 'JSON 内容为空，请给出完整的 JSON 文本。';
  }
  try {
    JSON.parse(content);
    return null;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return (
      `JSON 格式不合法（${reason}）。content 必须是完整可解析的 JSON：` +
      '键与字符串用双引号、不能有尾随逗号、不能有注释。'
    );
  }
}

/**
 * CSV：只做**弱校验**（NUL 字符、引号配对），不校验列数一致。
 *
 * 列数不齐在 CSV 里是合法形态（尾列可空），强校验会误伤真实数据；
 * 引号未闭合则会把整表读成一个字段，属于"写入即损坏"，必须拦。
 */
export function validateCsv(content: string): string | null {
  if (content.includes('\0')) {
    return 'CSV 内容含 NUL 字符（不是文本），请改用二进制产出通道。';
  }
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== '"') continue;
    if (inQuotes && content[i + 1] === '"') {
      i += 1;
      continue;
    }
    inQuotes = !inQuotes;
  }
  if (inQuotes) {
    return 'CSV 引号未闭合：某个字段以 " 开头但没有配对的收尾引号。';
  }
  return null;
}
