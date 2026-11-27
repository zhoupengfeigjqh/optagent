import fs from 'node:fs';
import path from 'node:path';

export function removeTree(abs: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // 幂等：不存在即成功
    throw err;
  }

  if (!stat.isDirectory()) {
    fs.unlinkSync(abs);
    return;
  }

  for (const entry of fs.readdirSync(abs)) {
    removeTree(path.join(abs, entry));
  }
  fs.rmdirSync(abs);
}
