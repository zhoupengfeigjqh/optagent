import type { AgentDesignDocument } from '../config-center/agent-design.js';
import { scenarioFields, scenarioUploads, type AgentScenario } from '../config-center/scenario.js';
import { renderSoulMd } from '../config-center/soul-design.js';
import type { Logger } from 'pino';
import type { McpServiceConfigService } from '../mcp/service-config.js';
import type { SkillLibraryService } from '../skill-library/install.js';
import { ONTOLOGY_FILE, SECURITIES_FILE, type OntologyStore } from '../ontology/store.js';
import { TERM_MAPPING_FILE, buildTermMapping } from '../ontology/term-mapping.js';
import type { AgentArtifact, MaterializeFile } from '../../infra/opt-agent-writer.js';

export interface MaterializeContext {
  mcpConfigs: McpServiceConfigService;
  skills: SkillLibraryService;
  ontologies: OntologyStore;
  /** 017：术语字典降级时记一条结构化 warning（缺省不记，纯函数结果本身仍可测） */
  logger?: Logger;
}

export function buildMcpServerEntry(name: string, ctx: MaterializeContext): Record<string, unknown> | null {
  const config = ctx.mcpConfigs.readOrNull(name);
  if (!config) return null;

  const entry: Record<string, unknown> = { name, transport: config.transport };
  if (config.transport === 'stdio') {
    entry.command = config.command ?? '';
    if (config.args && config.args.length > 0) entry.args = config.args;
  } else {
    if (!config.url) return null;
    entry.url = config.url;
  }
  if (Object.keys(config.headers).length > 0) entry.headers = config.headers;
  if (Object.keys(config.file_args).length > 0) entry.file_args = config.file_args;
  if (config.confirmation !== 'never') entry.confirmation = config.confirmation;
  if (Object.keys(config.rules_fields).length > 0) entry.rules_fields = config.rules_fields;
  // 运行环境据此只把白名单里的工具挂给数字人，其余工具对模型不可见。
  if (config.allowed_tools.length > 0) entry.allowed_tools = config.allowed_tools;
  const toolLabels = Object.fromEntries(
    Object.entries(config.tool_labels).filter(
      ([tool]) => config.allowed_tools.length === 0 || config.allowed_tools.includes(tool),
    ),
  );
  if (Object.keys(toolLabels).length > 0) entry.tool_labels = toolLabels;
  return entry;
}

export function buildScenarioDocument(scenario: AgentScenario): Record<string, unknown> {
  const doc: Record<string, unknown> = {
    scenario: scenario.scenario,
    data_prep_dirs: scenario.data_prep_dirs,
  };
  const fields = scenarioFields(scenario);
  if (Object.keys(fields).length > 0) doc.data_prep_fields = fields;
  const uploads = scenarioUploads(scenario);
  if (uploads && Object.keys(uploads).length > 0) doc.data_prep_uploads = uploads;
  return doc;
}

export function buildAgentArtifact(design: AgentDesignDocument, ctx: MaterializeContext): AgentArtifact {
  const files: MaterializeFile[] = [
    { relPath: 'SOUL.md', content: renderSoulMd(design.soul) },
    {
      relPath: 'TOOL.json',
      content: `${JSON.stringify({ enabled: design.enabled_tools }, null, 2)}\n`,
    },
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

  // 与 `skills/` 平级。形状非法的引用在保存期已拒；这里再判一次，避免拼出
  // 三段路径（存量手改文件的兜底）。
  for (const ref of design.ontologies) {
    const parts = ref.split('/');
    if (parts.length !== 2) continue;
    const [scenario, ontologyName] = parts as [string, string];
    const detail = ctx.ontologies.read(scenario, ontologyName);
    const dir = `ontology/${scenario}/${ontologyName}`;
    files.push({ relPath: `${dir}/${ONTOLOGY_FILE}`, content: detail.content });
    files.push({ relPath: `${dir}/${SECURITIES_FILE}`, content: detail.securities_content });
    // 017：术语字典随本体一并物化。派生件，任何解析问题都只降级为 `{}`，
    const mapping = buildTermMapping(detail.content);
    files.push({ relPath: `${dir}/${TERM_MAPPING_FILE}`, content: mapping.json });
    if (mapping.warnings.length > 0) {
      ctx.logger?.warn(
        {
          event: 'deploy.term_mapping.degraded',
          agent_name: design.name,
          ontology: ref,
          warnings: mapping.warnings,
        },
        '术语字典生成降级（本体与安全管控照常物化）',
      );
    }
  }

  return { name: design.name, files };
}

export function buildUserArtifacts(designs: AgentDesignDocument[], ctx: MaterializeContext): AgentArtifact[] {
  return designs.map((design) => buildAgentArtifact(design, ctx));
}
