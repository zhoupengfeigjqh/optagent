import type { FileAccess } from '../file-access.js';

export async function listToolDir(fa: FileAccess, dir: string): Promise<string> {
  const entries = await fa.list(dir);
  if (entries.length === 0) return `目录 ${dir} 为空`;
  const lines = entries.map(
    (e) =>
      `${e.isDirectory ? '[目录]' : '[文件]'} ${e.name}  ${e.isDirectory ? '' : `${e.size} 字节  `}更新于 ${e.modifiedAt}`,
  );
  return `目录 ${dir} 共 ${entries.length} 项：\n${lines.join('\n')}`;
}
