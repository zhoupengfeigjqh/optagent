export function scopeToolsByAllowlist<T extends { name: string }>(
  tools: T[],
  allowedTools: string[] | undefined,
): T[] {
  if (!allowedTools || allowedTools.length === 0) return tools;
  return tools.filter((tool) => allowedTools.includes(tool.name));
}
