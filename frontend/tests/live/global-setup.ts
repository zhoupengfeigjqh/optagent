/**
 * live 联调的全局前后置：起停真实后端。
 *
 * - `:3000` 已在跑 → **复用**（不动别人的进程）
 * - 否则以 `node --env-file=.env --import tsx src/server.ts` 起一个（等价 `npm run dev`，
 *   但绕开 npm/shell，Windows 上更可控），跑完杀掉
 */
import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const BASE = process.env.LIVE_BASE_URL ?? 'http://127.0.0.1:3000'
const READY_TIMEOUT_MS = 60_000

let child: ChildProcess | null = null

async function probe(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/api/agents`)
    return response.ok
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 启停前由 vitest 调用。 */
export async function setup(): Promise<void> {
  if (await probe()) {
    console.log(`[live] 复用已在运行的后端 ${BASE}`)
    return
  }

  const backendRoot = path.resolve(process.cwd(), '..', 'agent-backend')
  console.log(`[live] 启动后端：${backendRoot}`)
  child = spawn(
    process.execPath,
    ['--env-file=.env', '--import', 'tsx', 'src/server.ts'],
    { cwd: backendRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[backend] ${String(chunk)}`)
  })

  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`后端启动即退出（exitCode=${child.exitCode}），请手动运行 npm run dev 查看报错`)
    }
    if (await probe()) {
      console.log(`[live] 后端就绪 ${BASE}`)
      return
    }
    await sleep(500)
  }
  child.kill()
  throw new Error(`后端 ${READY_TIMEOUT_MS}ms 内未就绪`)
}

/** 所有用例结束后由 vitest 调用。 */
export async function teardown(): Promise<void> {
  // 把"当前选中"恢复为 demo：联调会切数字人，别把手工会话留在别的数字人上
  try {
    await fetch(`${BASE}/api/agents/current/exit`, { method: 'POST' })
    await fetch(`${BASE}/api/agents/demo/select`, { method: 'POST' })
    console.log('[live] 已把选中态恢复为 demo')
  } catch {
    /* 恢复失败不影响联调结论 */
  }

  if (!child) return
  child.kill()
  await sleep(500)
  console.log('[live] 已停止后端')
}
