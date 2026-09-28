/**
 * 纯函数测试：MCP 调用配置的基础字段判据（弹窗新建与详情页表单共用同一实现）。
 *
 * 覆盖三类场景（宪章原则三）：正常流程、异常流程（各类非法输入）、边界条件（空白、长度）。
 */
import { describe, expect, it } from 'vitest'
import { isValidMcpServiceName, validateMcpBasics } from './mcp-config'

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
