/**
 * 工具调用展示模型的纯函数测试（002 特性）
 *
 * 这里守的是**规则**（而非渲染）：状态文案的分流、可展开判定、计数口径、分组键稳定性。
 * 组件测试（`ToolCallList.spec.ts`）只验证"这些规则被用在了正确的位置"。
 */
import { describe, expect, it } from 'vitest'

import type { Message, ToolCallRecord } from '../api/types'
import {
  formatArgsDigest,
  formatBytes,
  formatDuration,
  isToolCallFinished,
  streamingToolCallItem,
  summarizeToolCalls,
  toToolCallItem,
  toolCallItemsOf,
  toolGroupKey,
  toolStatusLabel,
  type ToolCallItem,
} from './tool-calls'

function item(over: Partial<ToolCallItem> = {}): ToolCallItem {
  return { callId: 'c1', name: 'read_file', status: 'success', ...over }
}

describe('tool-calls —— 状态文案（TR-17 / TR-33）', () => {
  it('终态文案与 live 无关', () => {
    expect(toolStatusLabel('success', true)).toBe('已完成')
    expect(toolStatusLabel('success', false)).toBe('已完成')
    expect(toolStatusLabel('error', true)).toBe('失败')
    expect(toolStatusLabel('error', false)).toBe('失败')
  })

  it('running 必须分流：流式=进行中，非流式=未完成（不许把中断轮说成"进行中"）', () => {
    expect(toolStatusLabel('running', true)).toBe('进行中')
    expect(toolStatusLabel('running', false)).toBe('未完成')
  })
})

describe('tool-calls —— 可展开判定（TR-33）', () => {
  it('只有终态可展开（running 无结果可看）', () => {
    expect(isToolCallFinished('success')).toBe(true)
    expect(isToolCallFinished('error')).toBe(true)
    expect(isToolCallFinished('running')).toBe(false)
  })
})

describe('tool-calls —— 计数口径（TR-32）', () => {
  it('空数组：0 次调用、0 次报错', () => {
    expect(summarizeToolCalls([])).toEqual({ total: 0, errors: 0 })
  })

  it('全部成功：报错数为 0', () => {
    expect(summarizeToolCalls([item(), item({ callId: 'c2' })])).toEqual({ total: 2, errors: 0 })
  })

  it('统计的是**次数**：同一工具调两次算 2 次；running 不计入报错', () => {
    const stats = summarizeToolCalls([
      item({ callId: 'c1', name: 'sql_query', status: 'error' }),
      item({ callId: 'c2', name: 'sql_query', status: 'error' }),
      item({ callId: 'c3', name: 'sql_query', status: 'running' }),
    ])
    expect(stats).toEqual({ total: 3, errors: 2 })
  })
})

describe('tool-calls —— 本轮分组键（TR-36）', () => {
  it('取首个 call_id（流式与历史两条路径上都不变）', () => {
    expect(toolGroupKey([item({ callId: 'a' }), item({ callId: 'b' })])).toBe('a')
  })

  it('空数组返回空串（调用方据此不渲染）', () => {
    expect(toolGroupKey([])).toBe('')
  })
})

describe('tool-calls —— 契约映射', () => {
  it('历史记录：下划线字段映射为展示模型，可选字段缺省即不出现', () => {
    const record: ToolCallRecord = {
      call_id: 'c1',
      name: 'ocr_image',
      status: 'success',
      started_at: '2026-10-08T00:00:00.000Z',
      duration_ms: 1620,
      size: 1843200,
      artifact_size: 1843200,
      summary: '识别到 12 页产能表',
      truncated: false,
      args_digest: { path: 'a.xlsx' },
    }
    const mapped = toToolCallItem(record)
    expect(mapped).toEqual({
      callId: 'c1',
      name: 'ocr_image',
      status: 'success',
      durationMs: 1620,
      size: 1843200,
      artifactSize: 1843200,
      summary: '识别到 12 页产能表',
      argsDigest: { path: 'a.xlsx' },
    })
    // `truncated === false` 不落进展示模型（只有"被截断"才提示）
    expect('truncated' in mapped).toBe(false)
  })

  it('消息无 tool_calls 时返回空数组（调用方无需判空）', () => {
    expect(toolCallItemsOf({ id: 'm1' } as Message)).toEqual([])
    expect(
      toolCallItemsOf({
        id: 'm1',
        tool_calls: [
          {
            call_id: 'c1',
            name: 'read_file',
            status: 'running',
            started_at: '2026-10-08T00:00:00.000Z',
          },
        ],
      } as Message),
    ).toEqual([{ callId: 'c1', name: 'read_file', status: 'running' }])
  })

  it('流式瞬态只映射名称与状态（结果尚未产生）', () => {
    expect(streamingToolCallItem({ call_id: 'c1', name: 'ocr', status: 'running' })).toEqual({
      callId: 'c1',
      name: 'ocr',
      status: 'running',
    })
  })
})

describe('tool-calls —— 格式化', () => {
  it('体积按 B / KB / MB 分档', () => {
    expect(formatBytes(120)).toBe('120 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1843200)).toBe('1.8 MB')
  })

  it('耗时按 ms / s 分档', () => {
    expect(formatDuration(84)).toBe('84ms')
    expect(formatDuration(1620)).toBe('1.6s')
  })

  it('入参摘要拼成一行可读文本', () => {
    expect(formatArgsDigest({ path: 'a.xlsx', sheet: '产能' })).toBe('path=a.xlsx  sheet=产能')
  })
})
