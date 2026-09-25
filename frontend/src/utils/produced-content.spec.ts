/**
 * 单元测试：产出正文的展示解析（纯函数）。
 *
 * 重点是**任何输入都不能抛异常**（展示层必须总能回落原文）与**降级原因准确**
 * （界面据此决定"结构化 / 原样 + 是否给提示"）。
 */
import { describe, expect, it } from 'vitest'
import {
  PRODUCED_JSON_MAX_CHARS,
  columnsOfRows,
  fallbackHint,
  parseProducedContent,
} from './produced-content'

describe('parseProducedContent', () => {
  it('JSON 对象 → 可结构化', () => {
    const result = parseProducedContent('{"status":"success","text":"产能表"}')

    expect(result.structured).toBe(true)
    expect(result.reason).toBe('')
    expect(result.value).toEqual({ status: 'success', text: '产能表' })
  })

  it('JSON 数组 → 可结构化', () => {
    const result = parseProducedContent('[1,2,3]')

    expect(result.structured).toBe(true)
    expect(result.value).toEqual([1, 2, 3])
  })

  it('标量 JSON → 不算结构化（原样展示更直观）', () => {
    for (const text of ['123', '"纯文本"', 'true', 'null']) {
      const result = parseProducedContent(text)
      expect(result.structured).toBe(false)
      expect(result.reason).toBe('scalar')
      expect(result.value).toBeNull()
    }
  })

  it('非法 JSON → invalid（不抛异常）', () => {
    expect(parseProducedContent('产能表\n冲压 1200')).toEqual({
      structured: false,
      value: null,
      reason: 'invalid',
    })
    expect(parseProducedContent('{ 坏掉的').reason).toBe('invalid')
  })

  it('空白 / null → empty', () => {
    for (const text of [null, '', '   \n\t ']) {
      expect(parseProducedContent(text)).toEqual({
        structured: false,
        value: null,
        reason: 'empty',
      })
    }
  })

  it('超过阈值 → 不解析（too_large），即便内容是合法 JSON', () => {
    const json = '{"a":1}'
    const result = parseProducedContent(json, json.length - 1)

    expect(result.structured).toBe(false)
    expect(result.reason).toBe('too_large')
    expect(result.value).toBeNull()
  })

  it('恰好等于阈值仍解析（边界不误伤）', () => {
    const json = '{"a":1}'

    expect(parseProducedContent(json, json.length).structured).toBe(true)
  })

  it('默认阈值是 256K 字符', () => {
    expect(PRODUCED_JSON_MAX_CHARS).toBe(256 * 1024)
  })
})

describe('fallbackHint', () => {
  it('只有 too_large 给提示（其余原样展示是预期行为，不必解释）', () => {
    expect(fallbackHint('too_large')).toContain('原始文本')
    expect(fallbackHint('invalid')).toBe('')
    expect(fallbackHint('scalar')).toBe('')
    expect(fallbackHint('empty')).toBe('')
    expect(fallbackHint('')).toBe('')
  })
})

describe('columnsOfRows', () => {
  it('取各元素键的并集，按首次出现顺序', () => {
    const rows = [
      { orderNo: 'WO-1', line: 'L1' },
      { line: 'L2', start: '2026-09-26' },
    ]

    expect(columnsOfRows(rows)).toEqual(['orderNo', 'line', 'start'])
  })

  it('非对象元素跳过（调用方保证全对象才走表格，这里防御）', () => {
    expect(columnsOfRows([{ a: 1 }, 'x', null, { b: 2 }])).toEqual(['a', 'b'])
  })

  it('空数组 → 空列', () => {
    expect(columnsOfRows([])).toEqual([])
  })
})
