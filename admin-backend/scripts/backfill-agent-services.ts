#!/usr/bin/env tsx
/**
 * 存量补齐（2026-11-27）：为**没有服务编码**的设计态数字人开通服务（028 §18）。
 *
 * 背景：数字人（设计态）与服务原本是两个实体且互不联动——只有 `POST /api/admin/agent-services`
 * 会建服务，而管理台没有建服务的界面，于是除早期批量灌入的 5 条外，其余数字人卡片都显示
 * 「未配置注册服务」。自本次起创建/复制数字人会**自动开通**服务；本脚本负责把历史缺口补齐。
 *
 * 用法：`npm run migrate:agent-services`
 *   - 读 `PLATFORM_DATA_DIR`（缺省 `./.platform-data`，与 dev/start 同口径）；
 *   - 遍历 `.platform-data/agents/*.json`，`name` = 文件名（与设计态落盘规则一致）；
 *   - **幂等**：已有服务的数字人原样跳过，不改任何既有编码 / 名称 / 启停状态；
 *   - 新增服务的 `code` 由平台生成、`name` 与 `platform_agent_name` 都取数字人名；
 *   - 无论服务是新开的还是既有的，都把登记簿里的 `code` 回填进设计态文档
 *     （旧文档没有该字段，卡片/详情据此显示编码；`code` 不参与部署，内容不变）。
 *
 * 注意：服务不参与部署清单，因此本脚本**不** bump `revision`（不会影响运行中的乐观锁）。
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { ensureAgentServiceFor } from '../src/domain/account/agent-services.js';
import { FileAccountStore } from '../src/domain/account/file-account-store.js';
import { AgentDesignService } from '../src/domain/config-center/agent-design.js';
import { PlatformStore } from '../src/infra/platform-store.js';

async function main(): Promise<void> {
  const dataRoot = path.resolve(process.cwd(), process.env.PLATFORM_DATA_DIR ?? './.platform-data');
  const agentsDir = path.join(dataRoot, 'agents');
  const names = fs.existsSync(agentsDir)
    ? fs
        .readdirSync(agentsDir)
        .filter((file) => file.endsWith('.json'))
        .map((file) => path.basename(file, '.json'))
        .sort()
    : [];

  console.log(`[migrate:agent-services] 数据目录：${dataRoot}`);
  console.log(`[migrate:agent-services] 设计态数字人：${names.length} 个`);

  const platformStore = new PlatformStore(dataRoot);
  const store = new FileAccountStore(platformStore);
  await store.init();

  const before = new Set(
    (await store.listAgentServices()).map((service) => service.platform_agent_name),
  );
  const created: Array<{ name: string; code: string }> = [];
  const backfilled: Array<{ name: string; code: string }> = [];

  for (const name of names) {
    const record = await ensureAgentServiceFor(store, name);
    if (!before.has(name)) created.push({ name, code: record.code });
    if (syncDesignCode(platformStore, name, record.code)) backfilled.push({ name, code: record.code });
  }

  const skipped = names.length - created.length;
  if (created.length === 0 && backfilled.length === 0) {
    console.log(`\n[migrate:agent-services] 无需补齐（${skipped} 个数字人均已有服务编码且设计态已回填）`);
    return;
  }

  if (created.length > 0) {
    console.log('\n[migrate:agent-services] 新开通：');
    for (const item of created) console.log(`    + ${item.name}  →  ${item.code}`);
  }
  if (backfilled.length > 0) {
    console.log('\n[migrate:agent-services] 设计态回填编码：');
    for (const item of backfilled) console.log(`    ~ ${item.name}  →  ${item.code}`);
  }
  console.log(
    `\n[migrate:agent-services] 完成：新开通 ${created.length} 个，回填 ${backfilled.length} 个，` +
      `跳过（已有服务）${skipped} 个`,
  );
}

/**
 * 把登记簿里的编码写进设计态文档（幂等）。
 *
 * 只写 `code` 一个字段，不动 `updated_at`/`revision`：编码是**标识的展示副本**，
 * 不参与部署，改它不构成一次配置变更。
 */
function syncDesignCode(store: PlatformStore, name: string, code: string): boolean {
  const rel = AgentDesignService.relPath(name);
  const doc = store.readJson<Record<string, unknown>>(rel);
  if (!doc || doc.code === code) return false;
  store.writeJson(rel, { ...doc, code });
  return true;
}

main().catch((err) => {
  console.error('[migrate:agent-services] 失败：', err);
  process.exit(1);
});
