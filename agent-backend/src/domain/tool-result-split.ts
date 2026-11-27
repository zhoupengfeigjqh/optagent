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

export interface ToolArtifactAccess {
  /** 写临时空间文件（文件名须 `{threadId}_` 前缀，由 FileAccess 强制） */
  write(threadId: string, filename: string, content: string): Promise<string>;
}

const BUILTIN_TOOL_SET: ReadonlySet<string> = new Set(builtinToolNames());

export interface SplitPlan {
  inlineContent?: string;
  truncated?: boolean;
  summary?: string;
  /** 有值 = 需要写入临时空间（外部来源） */
  artifact?: { filename: string; content: string; size: number };
}

export interface PlanSplitInput {
  name: string;
  resultText: string;
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
