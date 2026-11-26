import path from 'node:path';

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
import { grepSkillFiles } from '../domain/tools/grep-skill.js';
import { grepToolFiles } from '../domain/tools/grep-files.js';
import { listToolDir } from '../domain/tools/list-dir.js';
import { readToolFile } from '../domain/tools/read-file.js';
import { readSkillFile, SkillAccessError } from '../domain/tools/read-skill.js';
import { writeToolFile } from '../domain/tools/write-file.js';
import { ContentFormatError, WriteTooLargeError } from '../domain/tools/write-modes.js';
import { toolErrorResult } from '../domain/tool-error.js';

export interface BuiltinToolsOptions {
  fileAccess: FileAccess;
  threadId: string;
  enabled: string[];
  /** 可供 list_dir 的目录清单（建 run 时按 scenario 动态生成，如 ['数据准备/生产计划', …, '临时空间']） */
  availableDirs: string[];
  skillsDir: string;
  /**
   * `write_file` 落盘字节上限（2026-11-16）。生产由 `server.ts` 注入
   * `PREVIEW_MAX_MB`，与预览上限同源；未注入时取 `DEFAULT_WRITE_MAX_BYTES`。
   */
  maxWriteBytes?: number;
  logger: Logger;
}

type ExecuteFn = (params: Record<string, unknown>) => Promise<string> | string;

function textResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

/**
 * 配置里的工具名在目录里找不到（TOOL.json 与服务端目录错配）。
 *
 * 不静默、不降级成"正常返回"：模型会以为自己拿到了一个能用的工具，
 * 而用户看到的是一张绿色的卡片——真正的问题（配置错）被藏起来了。
 */
class UnknownBuiltinToolError extends Error {}

function wrap(name: string, opts: BuiltinToolsOptions, fn: ExecuteFn) {
  return async (_toolCallId: string, rawParams: unknown): Promise<AgentToolResult<unknown>> => {
    const params = (rawParams ?? {}) as Record<string, unknown>;
    try {
      return textResult(await fn(params));
    } catch (err) {
      if (err instanceof UnknownBuiltinToolError) {
        opts.logger.error(
          { alert: true, event: 'tool.not_implemented', thread_id: opts.threadId, tool: name },
          `内置工具未实现（配置错配）：${name}`,
        );
        return toolErrorResult(`未知内置工具：${name}`, 'TOOL_NOT_IMPLEMENTED');
      }
      if (err instanceof PermissionError) {
        const event = name === 'write_file' ? 'file.write.denied' : 'file.access.denied';
        opts.logger.warn(
          { alert: true, event, thread_id: opts.threadId, tool: name },
          `工具 ${name} 越权被拒绝：${err.message}`,
        );
        // 标记失败（2026-10-29）：越权是用户该感知的"没做成"，卡片必须红；
        return toolErrorResult(
          `没有权限执行该操作：${err.message}。请向用户说明该目录为只读，可改为写入临时空间 tmp/。`,
          'FILE_ACCESS_DENIED',
        );
      }
      if (err instanceof ContentFormatError) {
        opts.logger.warn(
          {
            event: 'file.write.rejected',
            thread_id: opts.threadId,
            tool: name,
            code: err.code,
          },
          `工具 ${name} 内容与扩展名不匹配：${err.message}`,
        );
        return toolErrorResult(`内容与扩展名不匹配：${err.message}`, err.code);
      }
      if (err instanceof WriteTooLargeError) {
        opts.logger.warn(
          {
            event: 'file.write.rejected',
            thread_id: opts.threadId,
            tool: name,
            code: err.code,
          },
          `工具 ${name} 写入超限：${err.message}`,
        );
        return toolErrorResult(`写入失败：${err.message}`, err.code);
      }
      if (err instanceof SkillAccessError) {
        // 技能目录恒只读，且"改写临时空间"这类建议与技能无关
        opts.logger.warn(
          { alert: true, event: 'file.access.denied', thread_id: opts.threadId, tool: name },
          `工具 ${name} 越权被拒绝：${err.message}`,
        );
        return toolErrorResult(`技能文件访问被拒绝：${err.message}`, 'SKILL_ACCESS_DENIED');
      }
      if (err instanceof CalculatorError) {
        return toolErrorResult(`表达式无法计算：${err.message}`, 'CALCULATION_FAILED');
      }
      opts.logger.error(
        { err, thread_id: opts.threadId, tool: name, event: 'tool.failed' },
        `工具 ${name} 执行失败`,
      );
      return toolErrorResult(
        `工具执行失败：${err instanceof Error ? err.message : String(err)}`,
        'TOOL_EXECUTION_FAILED',
      );
    }
  };
}

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
        const r = await writeToolFile(fa, opts.threadId, String(p.filename), String(p.content), {
          maxBytes: opts.maxWriteBytes,
        });
        return JSON.stringify({
          message: `已写入 ${r.path}（${r.bytes} 字节）`,
          filePath: r.path,
          filePathName: path.basename(r.path),
          bytes: r.bytes,
          mode: r.mode,
        });
      };
    case 'list_dir':
      return (p) => listToolDir(fa, String(p.dir));
    case 'grep_files':
      return (p) =>
        grepToolFiles(fa, String(p.pattern), typeof p.dir === 'string' ? p.dir : undefined);
    case 'calculator':
      return (p) => calcTool(String(p.expression));
    case 'read_skill':
      return (p) =>
        readSkillFile(opts.skillsDir, p.skill, p.path, {
          offset: typeof p.offset === 'number' ? p.offset : undefined,
          limit: typeof p.limit === 'number' ? p.limit : undefined,
          truncateBytes: fa.truncateBytes,
        }).text;
    case 'grep_skill':
      return (p) => grepSkillFiles(opts.skillsDir, p.pattern, p.skill);
    default:
      // 目录里查不到的启用项：抛给 wrap 统一转成标记失败（不能伪装成正常返回）
      return async () => {
        throw new UnknownBuiltinToolError(name);
      };
  }
}

export function buildBuiltinTools(opts: BuiltinToolsOptions): AgentTool[] {
  const { enabled, availableDirs } = opts;

  // 运行期取值：与改造前逐一对应（dirsText / examplePath / firstDir / threadId / 临时空间）
  const values: Partial<TemplateValues> = {
    可用目录: availableDirs.join('、'),
    示例路径: availableDirs[0] ? `${availableDirs[0]}/示例.csv` : '临时空间/示例.csv',
    首个目录: availableDirs[0] ?? '临时空间',
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
