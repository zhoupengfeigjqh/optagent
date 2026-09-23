/**
 * 内置工具 → pi-agent-core AgentTool 适配（T037/T038 装配，T041 降级策略）。
 *
 * domain/tools 是纯业务函数（不依赖 pi）；这里包成 AgentTool 并把异常翻译成
 * 工具结果文本返回给模型——对话不中断（FR-022）：
 * - PermissionError → 自然语言"没有权限"，写操作记日志 file.write.denied（alert）
 * - CalculatorError 等业务错误 → 错误说明文本
 * - 未知异常 → 通用失败文本（并记 error 日志）
 *
 * **R1 改造后**：元数据不再内联于本文件，改为**消费**
 * `domain/builtin-tool-catalog.ts` 的单一来源目录；说明与入参模板在装配时
 * 用当前 run 的运行期取值渲染。对模型可见的文本**逐字不变**
 * （由 `tests/unit/builtin-tool-catalog.spec.ts` 守住）。
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';
import {
  BUILTIN_TOOL_CATALOG,
  renderDeep,
  renderTemplate,
  type TemplateValues,
} from '../domain/builtin-tool-catalog.js';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { calcTool, CalculatorError } from '../domain/tools/calculator.js';
import { grepToolFiles } from '../domain/tools/grep-files.js';
import { listToolDir } from '../domain/tools/list-dir.js';
import { readToolFile } from '../domain/tools/read-file.js';
import { readSkillFile, SkillAccessError } from '../domain/tools/read-skill.js';
import { writeToolFile } from '../domain/tools/write-file.js';

export interface BuiltinToolsOptions {
  fileAccess: FileAccess;
  /** 写产出的 thread_id 前缀 */
  threadId: string;
  /** TOOL.json 启用的工具名 */
  enabled: string[];
  /** 可供 list_dir 的目录清单（建 run 时按 scenario 动态生成，如 ['数据准备/生产计划', …, '共享空间', '临时空间']） */
  availableDirs: string[];
  /**
   * 本数字人的技能目录（`users/{uid}/agents/{agent}/skills`），`read_skill` 的沙箱根。
   *
   * 与用户三空间分开，故**不经过 `FileAccess`**——由 `domain/tools/read-skill.ts`
   * 自带一套"只读 + 只能落在该技能目录内"的校验。
   */
  skillsDir: string;
  logger: Logger;
}

type ExecuteFn = (params: Record<string, unknown>) => Promise<string> | string;

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

function wrap(name: string, opts: BuiltinToolsOptions, fn: ExecuteFn) {
  return async (_toolCallId: string, rawParams: unknown): Promise<AgentToolResult<unknown>> => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    try {
      return textResult(await fn(params));
    } catch (err) {
      if (err instanceof PermissionError) {
        // FR-022：越权不中断对话；写违规按契约记 file.write.denied
        const event = name === 'write_file' ? 'file.write.denied' : 'file.access.denied';
        opts.logger.warn(
          { alert: true, event, thread_id: opts.threadId, tool: name },
          `工具 ${name} 越权被拒绝：${err.message}`,
        );
        return textResult(
          `没有权限执行该操作：${err.message}。请向用户说明该目录为只读，可改为写入临时空间 tmp/。`,
        );
      }
      if (err instanceof SkillAccessError) {
        // 技能内的越权/越界访问：与文件越权同口径记 alert，但文案不同——
        // 技能目录恒只读，且"改写临时空间"这类建议与技能无关
        opts.logger.warn(
          { alert: true, event: 'file.access.denied', thread_id: opts.threadId, tool: name },
          `工具 ${name} 越权被拒绝：${err.message}`,
        );
        return textResult(`技能文件访问被拒绝：${err.message}`);
      }
      if (err instanceof CalculatorError) {
        return textResult(`表达式无法计算：${err.message}`);
      }
      opts.logger.error(
        { err, thread_id: opts.threadId, tool: name, event: 'tool.failed' },
        `工具 ${name} 执行失败`,
      );
      return textResult(`工具执行失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/** 各工具的领域实现（与元数据解耦，便于目录保持纯数据） */
function domainExecute(
  name: string,
  opts: BuiltinToolsOptions,
): (params: Record<string, unknown>) => Promise<string> | string {
  const fa = opts.fileAccess;
  switch (name) {
    case 'read_file':
      return async (p) =>
        (
          await readToolFile(fa, String(p.path), {
            offset: typeof p.offset === 'number' ? p.offset : undefined,
            limit: typeof p.limit === 'number' ? p.limit : undefined,
          })
        ).text;
    case 'write_file':
      return async (p) => {
        const r = await writeToolFile(fa, opts.threadId, String(p.filename), String(p.content));
        return `已写入 ${r.path}（${r.bytes} 字节）`;
      };
    case 'list_dir':
      return (p) => listToolDir(fa, String(p.dir));
    case 'grep_files':
      return (p) => grepToolFiles(fa, String(p.pattern), typeof p.dir === 'string' ? p.dir : undefined);
    case 'calculator':
      return (p) => calcTool(String(p.expression));
    case 'read_skill':
      return (p) =>
        readSkillFile(opts.skillsDir, p.skill, p.path, {
          offset: typeof p.offset === 'number' ? p.offset : undefined,
          limit: typeof p.limit === 'number' ? p.limit : undefined,
          truncateBytes: fa.truncateBytes,
        }).text;
    default:
      return async () => `未知内置工具：${name}`;
  }
}

export function buildBuiltinTools(opts: BuiltinToolsOptions): AgentTool[] {
  const { enabled, availableDirs } = opts;

  // 运行期取值：与改造前逐一对应（dirsText / examplePath / firstDir / threadId / 临时空间）
  const values: Partial<TemplateValues> = {
    可用目录: availableDirs.join('、'),
    示例路径: availableDirs[0] ? `${availableDirs[0]}/示例.csv` : '共享空间/示例.csv',
    首个目录: availableDirs[0] ?? '共享空间',
    会话标识: opts.threadId,
    临时空间: '临时空间',
  };

  return BUILTIN_TOOL_CATALOG.filter((entry) => enabled.includes(entry.name)).map((entry) => ({
    name: entry.name,
    label: entry.label,
    description: renderTemplate(entry.description_template, values),
    parameters: renderDeep(entry.parameters, values) as never,
    execute: wrap(entry.name, opts, domainExecute(entry.name, opts)),
  }));
}
