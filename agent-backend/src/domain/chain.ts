/**
 * 串行写链的公共尾声（2026-10-27）。
 *
 * 背景：`history` / `summary` / `tool-events` 三个 store 都用同一个模式保证同会话写盘
 * 有序——`chains: Map<key, Promise<void>>`，后一笔 `.then()` 挂在前一笔之后。键是
 * `用户/数字人/会话`，**永不清理**：长跑进程里键数随"历史上用过的会话数"无界增长
 * （每个键还牵着一个已 resolve 的 Promise，占住闭包与路径字符串）。
 *
 * 这里只做"删会话时释放一个键"，并且刻意把顺序写死：
 * 1. 先 `await` 当前链，等在途写落完；
 * 2. 再核对 Map 里**仍是同一个 Promise** 才删。
 *
 * 为什么必须核对：等待期间可能又排了新任务（Map 已被替换成新链），此时删除会让
 * 后来的写入另起一条链，与原链并发写同一个文件——宁可暂时多留一个键，也不能乱序。
 */
export async function disposeChain(
  chains: Map<string, Promise<void>>,
  key: string,
): Promise<void> {
  const chain = chains.get(key);
  if (!chain) return;
  await chain.catch(() => {});
  if (chains.get(key) === chain) chains.delete(key);
}
