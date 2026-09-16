/**
 * dirs 模块单测：场景（scenario.json）随**数字人**存放
 *
 * 运行方式（本地执行；容器只负责部署，见宪章原则三 / 原则八）：
 *   npm run test:all   # 全部测试
 *   npm run test       # 仅本目录单测
 *
 * 覆盖本次变更的核心约束：场景的存放与读取位置由**用户级**改为**数字人级**
 * （`users/{uid}/agents/{agent}/scenario.json`），使同一用户的不同数字人
 * 可以看到不同的文件空间。
 *
 * 说明：`tests/` 不在 tsconfig 的 include 内（不参与构建），此处用无扩展名导入，
 * 由 Vitest 解析到 `src/domain/dirs.ts`。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  DirValidationError,
  ScenarioNotConfiguredError,
  loadScenario,
  parseSpaceDir,
  scenarioPath,
} from '../../src/domain/dirs'

const root = mkdtempSync(path.join(tmpdir(), 'optagent-dirs-'))
const userId = 'admin'

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/**
 * 写入某个数字人的场景文件。
 *
 * 每个用例使用**独立的数字人名**：`loadScenario` 按 mtime 缓存，同一文件在同毫秒内
 * 被重写会命中旧缓存，用不同名字可彻底避开该抖动。
 */
function writeScenario(agentName: string, content: unknown): void {
  const dir = path.join(root, 'users', userId, 'agents', agentName)
  mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'scenario.json')
  if (content === null) {
    rmSync(file, { force: true })
    return
  }
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content), 'utf8')
}

/** 执行并返回抛出的错误；未抛错时返回 `null` */
function capture(fn: () => unknown): unknown {
  try {
    fn()
    return null
  } catch (error) {
    return error
  }
}

describe('scenarioPath - 场景随数字人存放', () => {
  it('落在数字人配置目录内', () => {
    expect(scenarioPath(root, userId, 'demo')).toBe(
      path.join(root, 'users', userId, 'agents', 'demo', 'scenario.json'),
    )
  })

  it('不再指向用户级路径（users/{uid}/scenario.json）', () => {
    expect(scenarioPath(root, userId, 'demo')).not.toBe(
      path.join(root, 'users', userId, 'scenario.json'),
    )
  })

  it('不同数字人的场景路径互不相同', () => {
    expect(scenarioPath(root, userId, 'demo')).not.toBe(scenarioPath(root, userId, 'demo2'))
  })
})

describe('loadScenario - 按数字人各自读取', () => {
  it('同一用户的两个数字人解析出不同的目录清单', () => {
    writeScenario('agent-full', { scenario: '生产调度', data_prep_dirs: ['生产计划', '产线信息'] })
    writeScenario('agent-lite', { scenario: '只读报表', data_prep_dirs: ['产线电价'] })

    const full = loadScenario(root, userId, 'agent-full')
    const lite = loadScenario(root, userId, 'agent-lite')

    expect(full.name).toBe('生产调度')
    expect(full.dataPrepDirs).toEqual(['生产计划', '产线信息'])
    expect(lite.name).toBe('只读报表')
    expect(lite.dataPrepDirs).toEqual(['产线电价'])
  })

  it('场景缺失时抛 ScenarioNotConfiguredError，且报错文案指名该数字人', () => {
    writeScenario('agent-missing', null)

    const error = capture(() => loadScenario(root, userId, 'agent-missing'))

    expect(error).toBeInstanceOf(ScenarioNotConfiguredError)
    expect((error as Error).message).toContain('agent-missing')
  })

  it('场景损坏（非法 JSON）时按未配置处理', () => {
    writeScenario('agent-broken', '{ not json')

    expect(capture(() => loadScenario(root, userId, 'agent-broken'))).toBeInstanceOf(
      ScenarioNotConfiguredError,
    )
  })

  it('场景名为空时按未配置处理', () => {
    writeScenario('agent-noname', { scenario: '   ', data_prep_dirs: ['产线信息'] })

    expect(capture(() => loadScenario(root, userId, 'agent-noname'))).toBeInstanceOf(
      ScenarioNotConfiguredError,
    )
  })

  it('非法目录名被跳过，合法项去重后保留', () => {
    writeScenario('agent-filter', {
      scenario: '生产调度',
      data_prep_dirs: ['产线信息', '../etc', '产线信息', ''],
    })

    expect(loadScenario(root, userId, 'agent-filter').dataPrepDirs).toEqual(['产线信息'])
  })
})

describe('parseSpaceDir - 目录清单按数字人判定', () => {
  it('同一目录在一个数字人下合法、在另一个数字人下被拒（403）', () => {
    writeScenario('agent-wide', { scenario: '全量', data_prep_dirs: ['生产计划', '产线电价'] })
    writeScenario('agent-narrow', { scenario: '精简', data_prep_dirs: ['产线电价'] })

    expect(parseSpaceDir(root, userId, 'agent-wide', '数据准备/生产计划').relPath).toBe(
      '数据准备/生产计划',
    )

    const error = capture(() =>
      parseSpaceDir(root, userId, 'agent-narrow', '数据准备/生产计划'),
    )

    expect(error).toBeInstanceOf(DirValidationError)
    expect((error as DirValidationError).statusCode).toBe(403)
  })

  it('共享空间与临时空间不受场景清单限制', () => {
    expect(parseSpaceDir(root, userId, 'agent-narrow', '共享空间').relPath).toBe('共享空间')
    expect(parseSpaceDir(root, userId, 'agent-narrow', '临时空间').relPath).toBe('临时空间')
  })

  it('路径穿越仍为 400（与场景无关的既有防线）', () => {
    const error = capture(() => parseSpaceDir(root, userId, 'agent-narrow', '../etc'))

    expect(error).toBeInstanceOf(DirValidationError)
    expect((error as DirValidationError).statusCode).toBe(400)
  })

  it('非三空间的一级目录为 403', () => {
    const error = capture(() => parseSpaceDir(root, userId, 'agent-narrow', '别的目录'))

    expect(error).toBeInstanceOf(DirValidationError)
    expect((error as DirValidationError).statusCode).toBe(403)
  })
})
