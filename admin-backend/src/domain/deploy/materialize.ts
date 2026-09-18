/**
 * 物化：把设计态 + 调用配置 + 共享技能库转成 `.opt-agent` 落盘产物
 * （`FR-026`、`FR-044`、`FR-056`，`data-model.md` §8）。
 *
 * 落盘格式 MUST 与运行环境既有读取口径**完全一致**
 * （`agent-backend/src/domain/agent-instance.ts` / `dirs.ts`）：
 * ```text
 * users/{uid}/agents/{agent}/
 * ├── SOUL.md          ← 设计态 soul 全文（utf8，原样）
 * ├── TOOL.json        ← { "enabled": [...] }
 * ├── MCP.json         ← { "servers": [ { name, transport, url|command, … } ] }
 * ├── scenario.json    ← { "scenario": "…", "data_prep_dirs": [...] }
 * └── skills/{name}/…  ← 从共享技能库物化的整包副本
 * ```
 *
 * **整体覆盖**：本模块产出的是"该数字人应当具有的**完整**内容清单"，
 * 平台侧未搭配的内容不会出现在清单里，因此不会残留（`FR-026`、`SC-018`）。
 */
import type { RuntimeForm } from '../platform-settings.js';
import type { AgentDesignDocument } from '../config-center/agent-design.js';
import { scenarioFields, type AgentScenario } from '../config-center/scenario.js';
import type { McpServiceConfigService } from '../mcp/service-config.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import type { AgentArtifact, MaterializeFile } from '../../infra/opt-agent-writer.js';

export interface MaterializeContext {
  form: RuntimeForm;
  mcpConfigs: McpServiceConfigService;
  skills: SkillLibraryService;
}

/** 构造 `MCP.json` 中的一条 server 声明（字段与运行环境的读取口径对齐） */
export function buildMcpServerEntry(
  name: string,
  ctx: MaterializeContext,
): Record<string, unknown> | null {
  const config = ctx.mcpConfigs.readOrNull(name);
  if (!config) return null;

  const entry: Record<string, unknown> = { name, transport: config.transport };
  if (config.transport === 'stdio') {
    entry.command = config.command ?? '';
    if (config.args && config.args.length > 0) entry.args = config.args;
  } else {
    // url **按目标运行形态取值**（FR-056）——设计态只持名称，不含连接信息
    const url = config.endpoints[ctx.form];
    if (!url) return null; // 缺目标形态地址：由部署前校验拦截，这里不静默回退
    entry.url = url;
  }
  if (Object.keys(config.file_args).length > 0) entry.file_args = config.file_args;
  // HITL 调用确认策略：never 是运行环境缺省语义，不写空壳（与 file_args 同一口径）
  if (config.confirmation !== 'never') entry.confirmation = config.confirmation;
  return entry;
}

/**
 * 构造 `scenario.json` 的落盘内容。
 *
 * `data_prep_fields` **仅在非空时写入**：运行环境（`agent-backend/src/domain/dirs.ts`）
 * 对"缺失"与"空对象"的解读一致（该目录无字段约束），故不写空壳
 * ——与"平台侧未搭配的内容不得残留"同一口径。
 */
export function buildScenarioDocument(scenario: AgentScenario): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    scenario: scenario.scenario,
    data_prep_dirs: scenario.data_prep_dirs,
  };
  const fields = scenarioFields(scenario);
  if (Object.keys(fields).length > 0) doc.data_prep_fields = fields;
  return doc;
}

/** 构造单个数字人的完整产物清单 */
export function buildAgentArtifact(
  design: AgentDesignDocument,
  ctx: MaterializeContext,
): AgentArtifact {
  const files: MaterializeFile[] = [
    { relPath: 'SOUL.md', content: design.soul },
    { relPath: 'TOOL.json', content: `${JSON.stringify({ enabled: design.enabled_tools }, null, 2)}\n` },
    {
      relPath: 'MCP.json',
      content: `${JSON.stringify(
        {
          servers: design.mcp_services
            .map((name) => buildMcpServerEntry(name, ctx))
            .filter((entry): entry is Record<string, unknown> => entry !== null),
        },
        null,
        2,
      )}\n`,
    },
    {
      relPath: 'scenario.json',
      content: `${JSON.stringify(buildScenarioDocument(design.scenario), null, 2)}\n`,
    },
  ];

  for (const skillName of design.skills) {
    for (const file of ctx.skills.readFiles(skillName)) {
      files.push({ relPath: `skills/${skillName}/${file.path}`, content: file.content });
    }
  }

  return { name: design.name, files };
}

/** 该用户全部数字人的产物清单（整体覆盖语义） */
export function buildUserArtifacts(
  designs: AgentDesignDocument[],
  ctx: MaterializeContext,
): AgentArtifact[] {
  return designs.map((design) => buildAgentArtifact(design, ctx));
}
