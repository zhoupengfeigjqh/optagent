export async function disposeChain(
  chains: Map<string, Promise<void>>,
  key: string,
): Promise<void> {
  const chain = chains.get(key);
  if (!chain) return;
  await chain.catch(() => {});
  if (chains.get(key) === chain) chains.delete(key);
}
