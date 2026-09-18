/**
 * 上传表字段校验（`domain/field-check.ts`，契约 runtime-api-delta.md §3.1 的消费端）
 *
 * 覆盖：
 * - 取值类型判定（6 种，含边界：符号 / 小数 / 指数 / 严格布尔 / JSON 顶层类型）
 * - CSV 解析（引号转义、`\r\n`、BOM、前导空行、GBK 回退）
 * - xlsx 解析（第一个 sheet、显示文本、空表）
 * - 校验问题清单（缺必填表头、逐行类型、空单元格跳过、行号口径、截断）
 *
 * 运行：npm run test（仅单元测试目录）
 */
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'

import type { ScenarioField } from '../../src/domain/dirs'
import {
  MAX_ISSUES,
  checkUploadBuffer,
  checkUploadTable,
  decodeCsvBuffer,
  parseCsvRows,
  parseXlsxRows,
  valueMatchesType,
} from '../../src/domain/field-check'

const FIELDS: ScenarioField[] = [
  { name: '产线编号', type: 'string', required: true },
  { name: '计划量', type: 'integer', required: false },
]

describe('valueMatchesType —— §3.1 判据', () => {
  it('string：任意非空文本通过，空串不匹配', () => {
    expect(valueMatchesType('abc', 'string')).toBe(true)
    expect(valueMatchesType('是', 'string')).toBe(true)
    expect(valueMatchesType('', 'string')).toBe(false)
    expect(valueMatchesType('  ', 'string')).toBe(false)
  })

  it('integer：整数字面量（可带符号），拒绝小数 / 指数 / 杂文本', () => {
    for (const ok of ['0', '42', '-7', '+13', '007']) {
      expect(valueMatchesType(ok, 'integer')).toBe(true)
    }
    for (const bad of ['1.5', '1e3', '-2.0', 'abc', '1,000', '12a']) {
      expect(valueMatchesType(bad, 'integer')).toBe(false)
    }
  })

  it('number：允许小数与指数', () => {
    for (const ok of ['0', '-3.14', '+.5', '1e3', '2.5E-2', '0.0']) {
      expect(valueMatchesType(ok, 'number')).toBe(true)
    }
    for (const bad of ['.', '+', '1.', 'e3', '3.4.5', 'NaN']) {
      expect(valueMatchesType(bad, 'number')).toBe(false)
    }
  })

  it('boolean：仅认严格 true / false', () => {
    expect(valueMatchesType('true', 'boolean')).toBe(true)
    expect(valueMatchesType('false', 'boolean')).toBe(true)
    for (const bad of ['TRUE', 'False', '1', '0', '是', '真']) {
      expect(valueMatchesType(bad, 'boolean')).toBe(false)
    }
  })

  it('object / array：可 JSON.parse 且顶层类型匹配（不校验嵌套内容）', () => {
    expect(valueMatchesType('{"a":1}', 'object')).toBe(true)
    expect(valueMatchesType('{"a":{"b":[1]}}', 'object')).toBe(true) // 嵌套不展开
    expect(valueMatchesType('[1,2]', 'object')).toBe(false)
    expect(valueMatchesType('null', 'object')).toBe(false)
    expect(valueMatchesType('not-json', 'object')).toBe(false)

    expect(valueMatchesType('[1,2]', 'array')).toBe(true)
    expect(valueMatchesType('[]', 'array')).toBe(true)
    expect(valueMatchesType('{"a":1}', 'array')).toBe(false)
    expect(valueMatchesType('[1,', 'array')).toBe(false)
  })
})

describe('parseCsvRows', () => {
  it('基本切分：逗号分隔、单元格 trim、跳过表头前导空行', () => {
    const table = parseCsvRows('\n\n产线编号, 计划量\nA1, 100\n')
    expect(table.header).toEqual(['产线编号', '计划量'])
    expect(table.rows).toEqual([['A1', '100']])
  })

  it('引号包裹：逗号不切断、`""` 转义、`\\r\\n` 行分隔', () => {
    const table = parseCsvRows('"a,1",x\r\n"a""b",y\r\n')
    expect(table.header).toEqual(['a,1', 'x'])
    expect(table.rows).toEqual([['a"b', 'y']])
  })

  it('边界：全空文件 → 空表头', () => {
    expect(parseCsvRows('')).toEqual({ header: [], rows: [] })
    expect(parseCsvRows('\n\n')).toEqual({ header: [], rows: [] })
  })
})

describe('decodeCsvBuffer', () => {
  it('UTF-8 去 BOM 直返；合法 UTF-8 不回退 GBK', () => {
    expect(decodeCsvBuffer(Buffer.from('﻿产线编号', 'utf8'))).toBe('产线编号')
    expect(decodeCsvBuffer(Buffer.from('abc', 'utf8'))).toBe('abc')
  })

  it('GBK 字节（无 BOM、非法 UTF-8 序列）回退 GBK 解码', () => {
    // 「中国」的 GBK 编码（D6D0 B9FA）：非法 UTF-8，触发回退
    const gbk = Buffer.from([0xd6, 0xd0, 0xb9, 0xfa])
    expect(decodeCsvBuffer(gbk)).toBe('中国')
  })
})

describe('parseXlsxRows', () => {
  function toXlsxBuf(matrix: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matrix), 'Sheet1')
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  }

  it('读取第一个 sheet，数值单元格取显示文本', () => {
    const buf = toXlsxBuf([
      ['产线编号', '计划量'],
      ['A1', 100],
    ])
    expect(parseXlsxRows(buf)).toEqual({ header: ['产线编号', '计划量'], rows: [['A1', '100']] })
  })

  it('边界：空工作簿 → 空表头', () => {
    expect(parseXlsxRows(toXlsxBuf([]))).toEqual({ header: [], rows: [] })
  })
})

describe('checkUploadTable —— 问题清单', () => {
  const table = (header: string[], rows: string[][]) => ({ header, rows })

  it('通过：必填表头齐全、取值类型匹配（可选字段缺席也过）', () => {
    expect(checkUploadTable(FIELDS, table(['产线编号'], [['A1']]))).toEqual([])
    expect(
      checkUploadTable(FIELDS, table(['产线编号', '计划量'], [['A1', '100']])),
    ).toEqual([])
  })

  it('缺少必填表头：一次性列出全部缺失', () => {
    const fields: ScenarioField[] = [
      { name: '甲', type: 'string', required: true },
      { name: '乙', type: 'string', required: true },
    ]
    expect(checkUploadTable(fields, table(['丙'], [['x']]))).toEqual([
      '缺少必填表头：「甲」、「乙」',
    ])
  })

  it('类型不符：逐行指出（表头为第 1 行，首条数据是第 2 行），可选字段出现则须匹配', () => {
    expect(
      checkUploadTable(FIELDS, table(['产线编号', '计划量'], [['A1', 'abc']])),
    ).toEqual(['第 2 行「计划量」取值 "abc" 类型不符（期望整数）'])
    expect(
      checkUploadTable(FIELDS, table(['产线编号', '计划量'], [['A1', '1'], ['A2', 'x']])),
    ).toEqual(['第 3 行「计划量」取值 "x" 类型不符（期望整数）'])
  })

  it('空单元格跳过类型判定（required 语义是表头必含，不做行级必填）', () => {
    expect(checkUploadTable(FIELDS, table(['产线编号', '计划量'], [['A1', '']]))).toEqual([])
  })

  it('重复表头取首个匹配列；超长取值截断展示', () => {
    const long = 'x'.repeat(40)
    const fields: ScenarioField[] = [{ name: '计划量', type: 'integer', required: false }]
    const issues = checkUploadTable(fields, table(['计划量', '计划量'], [[long, '100']]))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('第 2 行')
    expect(issues[0]).toContain(`${'x'.repeat(32)}…`)
  })

  it('问题超过 MAX_ISSUES 截断为「…等 N 处」', () => {
    const fields: ScenarioField[] = [{ name: 'n', type: 'integer', required: true }]
    const rows = Array.from({ length: MAX_ISSUES + 5 }, () => ['x'])
    const issues = checkUploadTable(fields, table(['n'], rows))
    expect(issues).toHaveLength(MAX_ISSUES + 1)
    expect(issues[MAX_ISSUES]).toContain(`等 ${MAX_ISSUES + 5} 处`)
  })

  it('边界：空表头 → 单条「没有读取到表头」', () => {
    expect(checkUploadTable(FIELDS, table([], []))).toEqual(['文件为空或没有读取到表头'])
  })
})

describe('checkUploadBuffer —— 按扩展名分派', () => {
  it('.csv 走 CSV 链路（UTF-8）', () => {
    const buf = Buffer.from('产线编号\nA1\n', 'utf8')
    expect(checkUploadBuffer(FIELDS, '.csv', buf)).toEqual([])
  })

  it('.xlsx 走 xlsx 链路', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['产线编号'], ['A1']]),
      'Sheet1',
    )
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
    expect(checkUploadBuffer(FIELDS, '.xlsx', buf)).toEqual([])
  })

  it('损坏的 xlsx 返回单条解析失败（不抛错）', () => {
    expect(checkUploadBuffer(FIELDS, '.xlsx', Buffer.from('not a zip'))).toEqual([
      '文件内容无法解析为有效表格（文件损坏或编码异常）',
    ])
  })
})
