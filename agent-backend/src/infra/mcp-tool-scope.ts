/**
 * MCP 工具白名单过滤（2026-10-03）。
 *
 * 平台在**新建服务**时由管理员勾选"可见工具"（`allowed_tools`），物化进 `MCP.json`；
 * 运行环境在装配工具表时按它过滤——**清单外的工具不进 Agent 工具表**，模型连
 * "有这个工具"都不知道，因此无从调用（比"调用时拒绝"更彻底，也省掉模型反复
 * 尝试的无效轮次）。
 *
 * 语义（与平台两侧同口径）：
 * - **缺省 / 空数组 = 不限制**（返回原表）：白名单上线前的存量 `MCP.json`、
 *   以及平台"非空才写"的物化口径都依赖这条——MUST NOT 读成"一个工具都不给"；
 * - 清单里**当前服务已不存在**的名字（下架/改名）自然过滤掉，不报错：运行期只关心
 *   "现在能挂什么"，"白名单失效"由管理平台详情页标异常（那里才有实时核对）；
 * - 输出**沿用服务返回的工具顺序**（白名单只做筛选，不重排）——顺序对运行期无意义，
 *   重排反而多一层无谓的状态；平台详情页则按白名单顺序呈现（那是给人看的）。
 */
export function scopeToolsByAllowlist<T extends { name: string }>(
  tools: T[],
  allowedTools: string[] | undefined,
): T[] {
  if (!allowedTools || allowedTools.length === 0) return tools;
  return tools.filter((tool) => allowedTools.includes(tool.name));
}
