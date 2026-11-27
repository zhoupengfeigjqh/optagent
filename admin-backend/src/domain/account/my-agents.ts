/**
 * 工作台「切换数字人」清单（2026-11-27 模型收敛后的口径）。
 *
 * **判据**：`users.agents[]`（授权 = 关联）**∩** 部署清单 `manifest.agent_names[]`。
 * 只有"已授权且已部署"的数字人才下发——授权后未部署、或取消授权后未清理的目录，
 * 都不出现在清单里（部署是唯一的生效闸门）。
 *
 * 为什么不再用 `user_agent_grants`：授权与关联合并后，grants 不再是独立真相源。
 *
 * `pending` 保留为空数组以维持既有响应契约（申请链路已随 grants 一并下线）。
 */
/** 只需服务目录的三列：编码 / 对外名称 / 平台落点名 */
export interface ServiceBrief {
  code: string;
  name: string;
  platform_agent_name: string;
}

export interface MyAgentsView {
  items: Array<{
    code: string;
    name: string;
    platform_agent_name: string;
    status: 'approved';
  }>;
  pending: Array<{ code: string; name: string; platform_agent_name: string }>;
}

/** 数据来源（便于单测注入；生产由 `AppContext` 装配） */
export interface MyAgentsSource {
  /** 该用户的授权/关联清单；用户不存在时返回 `null` */
  readAgents(userId: string): string[] | null;
  /** 该用户**已部署**的数字人名（`manifest.agent_names`） */
  deployedAgents(userId: string): string[];
  listServices(): Promise<ServiceBrief[]>;
}

export async function buildMyAgents(
  source: MyAgentsSource,
  userId: string,
): Promise<MyAgentsView> {
  const granted = source.readAgents(userId) ?? [];
  const deployed = new Set(source.deployedAgents(userId));
  const services = await source.listServices();
  const byPlatformName = new Map(services.map((service) => [service.platform_agent_name, service]));

  const items = granted
    .filter((name) => deployed.has(name))
    .map((name) => {
      const service = byPlatformName.get(name);
      return {
        // 未登记服务的数字人没有对外编码：仍可授权与部署，只是不能生成注册链接
        code: service?.code ?? '',
        name: service?.name ?? name,
        platform_agent_name: name,
        status: 'approved' as const,
      };
    });

  return { items, pending: [] };
}
