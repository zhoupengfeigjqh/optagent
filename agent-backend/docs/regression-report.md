# 全流程回归记录（T054 / T056）

日期：2026-09-09。quickstart.md 场景 1–6 逐项验证结果；自动化用例均可重跑复现。

## 自动化验证基线

- `npm test`（单元）：15 文件 126 用例 全绿
- `npm run test:integration`：7 文件 35 用例 全绿
- `npx tsc --noEmit` / `npm run lint`：零告警
- `npx vitest run --coverage`：domain 核心模块 Lines ≥96%
  （agent-pool 100%、history 100%、run-manager 96.2%、summary 97.7%、file-access 97.9%）
- `npx tsx scripts/perf.ts`：非 LLM 接口 P95 全部 ≤3ms（阈值 200ms）✅
- `npx tsx scripts/smoke.ts`（真 DeepSeek key）：4/4 通过 ✅

## 场景映射

| quickstart 场景 | 验证方式 | 结果 |
| --- | --- | --- |
| 1 对话（select→SSE→断连续跑→stop→3并发/第4个409） | `tests/integration/chat.test.ts`（四类事件序列、断连落盘、THREAD_RUN_ACTIVE/POOL_EXHAUSTED/THREAD_BUSY_LIMIT） | ✅ |
| 2 thread 管理（倒序/前20字标题/重命名/删除连带清理/分页；25+轮摘要） | `tests/integration/threads.test.ts` + `tests/unit/summary.test.ts`（窗口 19/20/21、失败降级） | ✅ |
| 3 文件（上传问答/越界超限/写生产计划被拒但对话继续/tmp产出下载） | `tests/integration/files.test.ts` + `tests/unit/tools.test.ts` + T041 对话不中断用例 | ✅ |
| 4 数字人查询（列表/详情/移走 SOUL.md 消失+告警/恢复重现） | `tests/integration/agents.test.ts` | ✅ |
| 5 监控/降级/用量（health 含 RSS/磁盘；unavailable_mcp；汇总吻合） | `tests/integration/monitor.test.ts` + `tests/unit/usage-db.test.ts` + smoke 用例 4（真 API 落库 records=1） | ✅ |
| 5.5 容量（POOL_SIZE=1 池满 409 POOL_EXHAUSTED） | `chat.test.ts`「POOL_EXHAUSTED：池满且无空闲可淘汰 → 409」 | ✅ |
| 6.1 容灾（坏行跳过/整体损坏重建+告警） | `tests/unit/history.test.ts` | ✅ |
| 6.2 优雅关闭（SIGTERM draining 写完落盘；宽限 abort ≤15s） | `tests/integration/graceful-shutdown.test.ts`（drained/aborted 两路径） | ✅ |

## 真 API 冒烟（scripts/smoke.ts，2026-09-09 实测）

| 用例 | 结果 |
| --- | --- |
| 1 thinking 开：thinking_delta→content_delta→done(usage) | ✅ 首事件 510ms（阈值 <5s） |
| 2 thinking 关：无 thinking_delta | ✅ 首事件 544ms |
| 3 AbortController 中断 → ABORTED error | ✅ |
| 4 HTTP 全链路：select→thread→SSE→stop→usage 落库 | ✅ 首字延迟 248ms，stop=true，usage records=1 |

## 遗留说明

- 冒烟脚本在 Windows 上偶发临时目录 EPERM（SQLite WAL 句柄释放延迟），已加
  maxRetries 重试；残留目录不影响结果，可手动删除 `%TEMP%\optagent-smoke-*`。
- 实时续推（resumed）按契约为二期候选，本期断连走拉历史（场景 1 已验证 running 字段）。
