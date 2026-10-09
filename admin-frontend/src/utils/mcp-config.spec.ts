/**
 * 纯函数测试：MCP 调用配置的基础字段判据（弹窗新建与详情页表单共用同一实现）。
 *
 * 覆盖三类场景（宪章原则三）：正常流程、异常流程（各类非法输入）、边界条件（空白、长度）。
 * 2026-10-08 追加**请求头**的本地解析（`parseHeaders` / `formatHeaders`）。
 */
import { describe, expect, it } from 'vitest'
import {
  formatHeaders,
  isValidHeaderName,
  isValidMcpServiceName,
  parseHeaders,
  validateMcpBasics,
} from './mcp-config'

describe('isValidMcpServiceName', () => {
  it.each([
    ['ocr', true],
    ['jev-service', true],
    ['hd_service_2', true],
    ['a', true],
    ['a'.repeat(64), true],
    ['a'.repeat(65), false],
    ['', false],
    ['bad name', false],
    ['中文名', false],
    ['a/b', false],
    ['a.b', false],
  ])('%s → %s', (name, expected) => {
    expect(isValidMcpServiceName(name)).toBe(expected)
  })
})

describe('validateMcpBasics —— http 传输', () => {
  it('连接地址为空 → 报「必填」', () => {
    expect(validateMcpBasics({ transport: 'http', url: '   ' })).toContain('连接地址必填')
  })

  it('连接地址不是 http(s) 绝对地址 → 报格式错误', () => {
    expect(validateMcpBasics({ transport: 'http', url: '192.168.1.2:8000/mcp' })).toContain(
      '连接地址须为',
    )
    expect(validateMcpBasics({ transport: 'http', url: 'ftp://host/mcp' })).toContain('连接地址须为')
  })

  it('合法地址 → 通过（https 同样接受）', () => {
    expect(validateMcpBasics({ transport: 'http', url: 'http://192.168.1.2:8000/mcp' })).toBeNull()
    expect(validateMcpBasics({ transport: 'http', url: 'https://mcp.example.com/mcp' })).toBeNull()
  })

  it('http 传输不校验启动命令（字段对该传输方式无意义）', () => {
    expect(
      validateMcpBasics({ transport: 'http', url: 'http://host:8000/mcp', command: '' }),
    ).toBeNull()
  })
})

describe('validateMcpBasics —— stdio 传输', () => {
  it('启动命令为空 → 报「必填」', () => {
    expect(validateMcpBasics({ transport: 'stdio', command: '  ' })).toContain('启动命令必填')
    expect(validateMcpBasics({ transport: 'stdio' })).toContain('启动命令必填')
  })

  it('有启动命令 → 通过（即便没填连接地址）', () => {
    expect(validateMcpBasics({ transport: 'stdio', command: 'python' })).toBeNull()
  })
})

describe('validateMcpBasics —— 服务名（仅新建时传入）', () => {
  it('非法服务名 → 报「服务名非法」', () => {
    expect(validateMcpBasics({ name: 'bad name', transport: 'http', url: 'http://h:1/mcp' })).toContain(
      '服务名非法',
    )
  })

  it('名称前后空白按 trim 判定（不误报）', () => {
    expect(validateMcpBasics({ name: ' ocr ', transport: 'http', url: 'http://h:1/mcp' })).toBeNull()
  })

  it('编辑态不传 name → 不校验名称（名称取自服务端且不可改）', () => {
    expect(validateMcpBasics({ transport: 'http', url: 'http://h:1/mcp' })).toBeNull()
  })

  it('服务名与地址都非法时，先报服务名（提交前的第一处必填）', () => {
    expect(validateMcpBasics({ name: '', transport: 'http', url: '' })).toContain('服务名非法')
  })
})

describe('isValidHeaderName —— 与后端同口径（RFC 7230 token）', () => {
  it.each([
    ['X-MCP-Token', true],
    ['x-mcp-token', true],
    ['X-Trace_2', true],
    ['', false],
    ['X Token', false],
    ['X:Token', false],
    ['令牌', false],
  ])('%s → %s', (name, expected) => {
    expect(isValidHeaderName(name)).toBe(expected)
  })
})

describe('parseHeaders —— 请求头文本框', () => {
  it('空串 / 纯空白 → `{}`（= 不带请求头）', () => {
    expect(parseHeaders('')).toEqual({ headers: {} })
    expect(parseHeaders('   \n ')).toEqual({ headers: {} })
  })

  it('合法 JSON 对象 → 头名与值两端 trim 后原样解析', () => {
    expect(parseHeaders('{"X-MCP-Token":"  tk-1234567890  "}')).toEqual({
      headers: { 'X-MCP-Token': 'tk-1234567890' },
    })
    expect(parseHeaders('{" X-Trace ":"abc"}')).toEqual({ headers: { 'X-Trace': 'abc' } })
  })

  it('非法 JSON → 给出可照抄的示例', () => {
    const r = parseHeaders('X-MCP-Token: tk')
    expect(r.error).toContain('合法 JSON')
    expect(r.error).toContain('X-MCP-Token')
  })

  it('非对象（数组 / 字符串 / null）→ 报「须为 JSON 对象」', () => {
    for (const text of ['["a"]', '"a"', 'null', '42']) {
      expect(parseHeaders(text).error).toContain('JSON 对象')
    }
  })

  it('值非字符串 / 空串 → 报错（并提示清空要用「清空全部请求头」）', () => {
    expect(parseHeaders('{"X-MCP-Token":123}').error).toContain('必须是字符串')
    expect(parseHeaders('{"X-MCP-Token":""}').error).toContain('不能为空')
    expect(parseHeaders('{"X-MCP-Token":"   "}').error).toContain('不能为空')
  })

  it('掩码值 → 直接拒绝（把回显的掩码提交回去 = 静默把令牌换成掩码）', () => {
    for (const masked of ['6UuE…F3Z', '••••']) {
      expect(parseHeaders(`{"X-MCP-Token":"${masked}"}`).error).toContain('掩码')
    }
  })

  it('头名非法 / 大小写不敏感重复 → 报错', () => {
    expect(parseHeaders('{"X Token":"v"}').error).toContain('请求头名称非法')
    expect(parseHeaders('{"X-A":"a","x-a":"b"}').error).toContain('重复')
  })

  it('值含换行 → 报错（header injection）', () => {
    expect(parseHeaders('{"X-MCP-Token":"a\\nb"}').error).toContain('单行')
  })
})

describe('formatHeaders', () => {
  it('空对象 / 缺省 → 空串（编辑框为空）', () => {
    expect(formatHeaders({})).toBe('')
    expect(formatHeaders(undefined)).toBe('')
  })

  it('非空 → 缩进 JSON（便于人工核对头名）', () => {
    expect(formatHeaders({ 'X-MCP-Token': 'tk' })).toBe('{\n  "X-MCP-Token": "tk"\n}')
  })
})
