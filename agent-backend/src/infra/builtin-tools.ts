/**
 * 内置工具 → pi-agent-core AgentTool 适配（T037/T038 装配，T041 降级策略）。
 *
 * domain/tools 是纯业务函数（不依赖 pi）；这里包成 AgentTool 并把异常翻译成
 * 工具结果文本返回给模型——对话不中断（FR-022）：
 * - PermissionError → 自然语言"没有权限"，写操作记日志 file.write.denied（alert）
 * - CalculatorError 等业务错误 → 错误说明文本
 * - 未知异常 → 通用失败文本（并记 error 日志）
 */
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import type { Logger } from 'pino';
import { FileAccess, PermissionError } from '../domain/file-access.js';
import { calcTool, CalculatorError } from '../domain/tools/calculator.js';
import { grepToolFiles } from '../domain/tools/grep-files.js';
import { listToolDir } from '../domain/tools/list-dir.js';
import { readToolFile } from '../domain/tools/read-file.js';
import { writeToolFile } from '../domain/tools/write-file.js';

export interface BuiltinToolsOptions {
  fileAccess: FileAccess;
  /** 写产出的 thread_id 前缀 */
  threadId: string;
  /** TOOL.json 启用的工具名 */
  enabled: string[];
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

export function buildBuiltinTools(opts: BuiltinToolsOptions): AgentTool[] {
  const { fileAccess: fa, threadId, enabled } = opts;
  const on = (name: string) => enabled.includes(name);

  const catalog: AgentTool[] = [];

  if (on('read_file')) {
    catalog.push({
      name: 'read_file',
      label: '读取文件',
      description:
        '读取用户业务目录或 tmp/ 下的文件内容。支持 .csv/.xlsx/.txt/.json/.pdf/.md/.log；' +
        'xlsx 自动转 CSV，pdf 提取文本层。大文件返回截断内容，可用 offset 继续分段读取。' +
        '参数 path 为相对目录的路径，如 "生产计划/xxx.csv"。',
      parameters: {
        type: 'object',
        required: ['path'],
        properties: {
          path: { type: 'string', description: '相对路径，如 "生产计划/计划.xlsx"' },
          offset: { type: 'number', description: '字节偏移（续读截断内容时用）' },
          limit: { type: 'number', description: '本次最多返回字节数' },
        },
      } as never,
      execute: wrap(
        'read_file',
        opts,
        async (p) =>
          (
            await readToolFile(fa, String(p.path), {
              offset: typeof p.offset === 'number' ? p.offset : undefined,
              limit: typeof p.limit === 'number' ? p.limit : undefined,
            })
          ).text,
      ),
    });
  }

  if (on('write_file')) {
    catalog.push({
      name: 'write_file',
      label: '写入临时文件',
      description:
        `把内容写入临时空间 tmp/，文件名会自动要求以 "${threadId}_" 开头。` +
        '业务目录（生产计划等）为只读，写入会被拒绝。写成功后可用路径 tmp/{filename} 告知用户下载。',
      parameters: {
        type: 'object',
        required: ['filename', 'content'],
        properties: {
          filename: { type: 'string', description: `文件名，必须以 ${threadId}_ 开头` },
          content: { type: 'string', description: '文件内容（utf8 文本）' },
        },
      } as never,
      execute: wrap('write_file', opts, async (p) => {
        const r = await writeToolFile(fa, threadId, String(p.filename), String(p.content));
        return `已写入 ${r.path}（${r.bytes} 字节）`;
      }),
    });
  }

  if (on('list_dir')) {
    catalog.push({
      name: 'list_dir',
      label: '列目录',
      description:
        '列出指定目录的文件（名称/大小/更新时间）。目录限：生产计划、产线信息、切换时间、求解时间、产线电价、目标优先级、使用规则、shared、tmp。',
      parameters: {
        type: 'object',
        required: ['dir'],
        properties: { dir: { type: 'string', description: '目录名，如 "生产计划"' } },
      } as never,
      execute: wrap('list_dir', opts, (p) => listToolDir(fa, String(p.dir))),
    });
  }

  if (on('grep_files')) {
    catalog.push({
      name: 'grep_files',
      label: '检索文件内容',
      description:
        '在文本类文件（.csv/.txt/.json/.md/.log）中按正则检索关键词；xlsx/pdf 会被跳过（请改用 read_file）。' +
        '可指定目录，缺省检索全部开放目录。',
      parameters: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string', description: '检索词或正则表达式' },
          dir: { type: 'string', description: '限定目录（可选）' },
        },
      } as never,
      execute: wrap('grep_files', opts, (p) =>
        grepToolFiles(fa, String(p.pattern), typeof p.dir === 'string' ? p.dir : undefined),
      ),
    });
  }

  if (on('calculator')) {
    catalog.push({
      name: 'calculator',
      label: '计算器',
      description:
        '计算数学表达式。支持 + - * / % ^、括号、sqrt/abs/round/floor/ceil/min/max/pow 函数与常量 pi/e。',
      parameters: {
        type: 'object',
        required: ['expression'],
        properties: { expression: { type: 'string', description: '数学表达式，如 "(1+2)*3"' } },
      } as never,
      execute: wrap('calculator', opts, (p) => calcTool(String(p.expression))),
    });
  }

  return catalog;
}
