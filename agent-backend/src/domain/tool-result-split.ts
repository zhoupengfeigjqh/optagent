/**
 * 工具结果的体积分流策略（2026-11-07；自 `tool-events.ts` 拆出，宪章原则二）。
 *
 * 三条规则（`inline_content` 任何分支都**只存前 `TOOL_INLINE_MAX_BYTES`**）：
 * - ≤ 内联阈值：原文内联；
 * - **内置工具**超阈值：截断内联 + 截断说明，**不落副本**——
 *   结果能用同一工具按更小范围 / offset 重取（`read_file`、`grep_files`…）；
 * - **外部来源**（MCP 等）超阈值：截断内联（尾注给出副本路径）+ 正文外置到临时空间。
 *   这类结果重取可能产生副作用或根本无法复现，**必须**留存。
 *
 * 本模块是**纯函数**：只算"事件行该写什么、要不要落盘"，不做任何 IO。
 */
import { builtinToolNames } from './builtin-tool-catalog.js';
import { SPACE_TMP } from './dirs.js';
import {
  TOOL_ARTIFACT_MAX_BYTES,
  TOOL_INLINE_MAX_BYTES,
  artifactFileName,
  artifactRelPath,
  summarizeResult,
  truncateToBytes,
  withRecordTruncationNote,
} from './tool-result.js';

/**
 * 外置正文的**写**口（装配层用 `FileAccess` 实现；缺省时超阈值结果退化为截断内联）。
 *
 * 只保留写入：正文回读在 2026-11-08 全部下线——模型侧按路径 `read_file`（走文件工具），
 * 前端卡片只展示记录里的 `inline_content`，没有任何代码需要后端代读副本。
 */
export interface ToolArtifactAccess {
  /** 写临时空间文件（文件名须 `{threadId}_` 前缀，由 FileAccess 强制） */
  write(threadId: string, filename: string, content: string): Promise<string>;
}

/** 内置工具名集合（来自工具目录的唯一来源，不维护第二份名单） */
const BUILTIN_TOOL_SET: ReadonlySet<string> = new Set(builtinToolNames());

/** 分流计划：只描述"事件行该写什么"与"要落盘的正文是什么" */
export interface SplitPlan {
  inlineContent?: string;
  truncated?: boolean;
  summary?: string;
  /** 有值 = 需要写入临时空间（外部来源） */
  artifact?: { filename: string; content: string; size: number };
}

export interface PlanSplitInput {
  /** 调用名（决定内置 / 外部来源） */
  name: string;
  /** 已序列化的结果文本 */
  resultText: string;
  /** 原始结果字节数 */
  size: number;
  /** 装配层是否提供外置能力（false = 一律降级为截断内联） */
  canArtifact: boolean;
  threadId: string;
  callId: string;
}

export function planSplit(input: PlanSplitInput): SplitPlan {
  const { name, resultText, size } = input;
  if (size <= TOOL_INLINE_MAX_BYTES) return { inlineContent: resultText };
  if (BUILTIN_TOOL_SET.has(name) || !input.canArtifact) {
    return planTruncatedInline(resultText, size);
  }
  const bounded = truncateToBytes(resultText, TOOL_ARTIFACT_MAX_BYTES);
  return {
    // 记录里与内置工具同一口径：只留前一段，末尾给出副本路径供模型 read_file 取回全文
    inlineContent: withRecordTruncationNote(
      truncateToBytes(resultText, TOOL_INLINE_MAX_BYTES).text,
      size,
      { artifactPath: artifactRelPath(input.threadId, input.callId, SPACE_TMP) },
    ),
    truncated: true,
    summary: summarizeResult(bounded.text),
    artifact: {
      filename: artifactFileName(input.threadId, input.callId),
      content: bounded.text,
      size: Buffer.byteLength(bounded.text, 'utf8'),
    },
  };
}

/**
 * 截断内联计划。
 *
 * 内置工具与"外置不可用"共用同一句说明——对模型而言两件事一样（记录里只有前 32KB），
 * 文案若不同，它会以为两种截断有不同的补救方式。
 */
export function planTruncatedInline(resultText: string, size: number): SplitPlan {
  const bounded = truncateToBytes(resultText, TOOL_INLINE_MAX_BYTES);
  return { inlineContent: withRecordTruncationNote(bounded.text, size), truncated: true };
}
