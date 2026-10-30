/**
 * 对话并发额度（**唯一来源**）。
 *
 * 手动对话（`routes/chat.ts`）与定时任务执行器（`domain/scheduled-task-runner.ts`）
 * 共用同一额度：否则定时任务可以绕开用户在聊天区看到的"最多 3 个进行中"，
 * 表现为"我这边明明在跑 3 个，后台又插进来一个"，把池与模型配额打爆。
 *
 * 该常量原先散落在 `routes/chat.ts`；2026-10-30（015）抽到此处，避免第二份口径
 * （宪章原则二：同一职责唯一来源）。
 */
export const MAX_ACTIVE_THREADS_PER_USER = 3;
